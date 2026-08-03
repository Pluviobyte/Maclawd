import Foundation

/// 运行时状态快照，对应 Node 端 `/api/state` 的返回。
/// 窗口内的归一化矩形，0…1，AppKit 左下原点。
struct NormalizedRect {
    var x0: CGFloat
    var x1: CGFloat
    var y0: CGFloat
    var y1: CGFloat

    /// 换算到给定边长的正方形窗口里。
    func rect(in side: CGFloat) -> NSRect {
        NSRect(x: side * x0, y: side * y0, width: side * (x1 - x0), height: side * (y1 - y0))
    }

    init?(_ raw: Any?) {
        guard let d = raw as? [String: Any],
              let x0 = d["x0"] as? Double, let x1 = d["x1"] as? Double,
              let y0 = d["y0"] as? Double, let y1 = d["y1"] as? Double,
              x1 > x0, y1 > y0
        else { return nil }
        self.x0 = x0; self.x1 = x1; self.y0 = y0; self.y1 = y1
    }
}

struct RuntimeState {
    var actionId: String = "idle"
    var variant: String?
    var name: String = ""
    var source: String?
    var durationMs: Int?
    var mode: String = "loop"
    var next: String?
    var motion: Bool = true
    /// 是否处于 mini（贴边）尺寸档。由运行时决定，外壳只跟随。
    var mini: Bool = false
    /// 可点击区域，窗口内的归一化矩形（AppKit 左下原点）。**按动作变**——
    /// 俯视平躺的 sleeping 比站立扁得多。由运行时按契约算好下发，
    /// 外壳不再自己保存一份几何常量。
    var hitBox: NormalizedRect?
    /// 可见画面框。夹到屏幕内时用它，**不是窗口框**——
    /// 窗口 135×135 而角色只占 45×27，按窗口夹的话角色永远贴不到屏幕边。
    var marginBox: NormalizedRect?
    var reason: String = ""
    var tokensPerMin: Int = 0
    var disabled: Bool = false
    var energy: Double = 1
}

/// 面板数字，对应 `/api/summary`。
struct UsageSnapshot {
    var billable: Int = 0
    var throughput: Int = 0
    var cost: Double?
    var coverage: Double = 1
    var hitRate: Double = 0
    var activeSeconds: Int = 0
}

/**
 状态引擎的唯一实现留在 Node 侧，Swift 只做渲染。

 这不是偷懒——把状态机在 Swift 里重写一遍就有了两份实现，
 两份实现必然漂移，而漂移的表现是「桌宠的动作和面板的数字对不上」，
 那种 bug 极难定位。所以外壳通过 127.0.0.1 消费同一个引擎。

 外壳负责把 Node 运行时作为子进程带起来，用户不需要自己开终端。
 */
final class RuntimeClient {
    private let port: Int
    private var process: Process?
    private let session: URLSession
    private let repoRoot: URL

    private(set) var state = RuntimeState()
    private(set) var usage = UsageSnapshot()
    private(set) var lastError: String?

    var onUpdate: (() -> Void)?

    init(repoRoot: URL, port: Int = 4173) {
        self.repoRoot = repoRoot
        self.port = port
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        self.session = URLSession(configuration: config)
    }

    var panelURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    var usageURL: URL { URL(string: "http://127.0.0.1:\(port)/usage")! }

    // MARK: - 子进程

    /// 找 node。GUI 进程不继承用户 shell 的 PATH，所以要显式探测常见位置。
    /**
     找到可用的 Node。

     顺序刻意是「**随包的优先**」：分发出去的应用不能指望用户机器上有 Node。
     不打包时的失败模式全是静默的——nvm 装的 node 不在 login shell 之外的
     PATH 里、版本过旧、或只有 x86 版——用户只会看到「桌宠没出来」，
     根本不知道是缺运行时。

     系统 node 只作为开发期回落（从源码目录直接跑时包里没有 Resources/node）。
     */
    private func findNode() -> String? {
        var candidates: [String] = []
        if let resources = Bundle.main.resourceURL {
            // 通用包里两个架构的运行时都在。`#if arch` 在通用二进制里是
            // **按切片**解析的——arm64 切片编译出 "arm64"，x86_64 切片编译出
            // "x64"，所以每一份跑起来都会挑到自己那个。运行时判断反而做不到这点。
            #if arch(arm64)
            let slice = "arm64"
            #else
            let slice = "x64"
            #endif
            candidates.append(resources.appendingPathComponent("node/\(slice)/bin/node").path)
            // 旧布局（单架构包把 node 直接放在 node/bin 下），保持兼容
            candidates.append(resources.appendingPathComponent("node/bin/node").path)
        }
        candidates += [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        // 兜底：借一次 login shell 去问
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
        probe.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        probe.standardOutput = pipe
        probe.standardError = FileHandle.nullDevice
        do {
            try probe.run()
            probe.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let found = String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !found.isEmpty, FileManager.default.isExecutableFile(atPath: found) { return found }
        } catch {
            // 探测失败就走下面的报错路径
        }
        return nil
    }

    func startRuntime() {
        guard process == nil else { return }
        guard let node = findNode() else {
            lastError = "未找到 node。Maclawd 的采集运行时需要 Node ≥ 20。"
            return
        }
        let script = repoRoot.appendingPathComponent("bin/maclawd-usage.js")
        guard FileManager.default.fileExists(atPath: script.path) else {
            lastError = "未找到 \(script.path)"
            return
        }

        let task = Process()
        task.executableURL = URL(fileURLWithPath: node)
        task.arguments = [script.path, "serve", String(port)]
        task.currentDirectoryURL = repoRoot
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            process = task
        } catch {
            lastError = "启动运行时失败: \(error.localizedDescription)"
        }
    }

    func stopRuntime() {
        process?.terminate()
        process = nil
    }

    // MARK: - 轮询

    private func get(_ path: String, _ handler: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else {
            handler(nil)
            return
        }
        session.dataTask(with: url) { data, _, _ in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                handler(nil)
                return
            }
            handler(json)
        }.resume()
    }

    /// 把外壳自己的输入与系统事件回灌给状态引擎。
    ///
    /// 这条回路缺了很久：外壳里早有拖拽和点击的代码，但事件从没送出去，
    /// 于是 Poke Squish、Curtain Peek、Low Battery Droop 这些画好的动作
    /// 一次都没在屏幕上出现过。
    func send(shellEvent type: String) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/event") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["type": type])
        // 即发即忘：外壳的交互反馈不该因为运行时慢而卡住 UI
        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    func refresh() {
        get("/api/state") { [weak self] json in
            guard let self, let json else { return }
            var next = RuntimeState()
            if let s = json["state"] as? [String: Any] {
                next.actionId = s["actionId"] as? String ?? "idle"
                next.variant = s["variant"] as? String
                next.reason = s["reason"] as? String ?? ""
            }
            if let p = json["plan"] as? [String: Any] {
                next.name = p["name"] as? String ?? ""
                next.source = p["source"] as? String
                next.durationMs = p["durationMs"] as? Int
                next.mode = p["mode"] as? String ?? "loop"
                next.next = p["next"] as? String
                next.motion = p["motion"] as? Bool ?? true
                if let g = p["geometry"] as? [String: Any] {
                    next.hitBox = NormalizedRect(g["hit"])
                    next.marginBox = NormalizedRect(g["margin"])
                }
            }
            next.mini = json["mini"] as? Bool ?? false
            if let d = json["debug"] as? [String: Any] {
                next.energy = d["energy"] as? Double ?? 1
                next.tokensPerMin = d["rate"] as? Int ?? 0
            }
            next.disabled = self.state.disabled
            self.state = next
            DispatchQueue.main.async { self.onUpdate?() }
        }

        get("/api/live") { [weak self] json in
            guard let self, let json else { return }
            self.state.tokensPerMin = json["tokensPerMin"] as? Int ?? 0
            self.state.disabled = json["disabled"] as? Bool ?? false
            DispatchQueue.main.async { self.onUpdate?() }
        }

        get("/api/summary?range=today") { [weak self] json in
            guard let self, let json else { return }
            var snapshot = UsageSnapshot()
            if let s = json["summary"] as? [String: Any] {
                snapshot.billable = s["billable"] as? Int ?? 0
                snapshot.throughput = s["throughput"] as? Int ?? 0
                snapshot.cost = s["cost"] as? Double
                snapshot.hitRate = s["hitRate"] as? Double ?? 0
            }
            snapshot.coverage = json["coverage"] as? Double ?? 1
            if let sessions = json["sessions"] as? [String: Any] {
                snapshot.activeSeconds = sessions["activeSeconds"] as? Int ?? 0
            }
            self.usage = snapshot
            DispatchQueue.main.async { self.onUpdate?() }
        }
    }
}
