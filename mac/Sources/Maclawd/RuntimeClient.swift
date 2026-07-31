import Foundation

/// 运行时状态快照，对应 Node 端 `/api/state` 的返回。
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
    private func findNode() -> String? {
        let candidates = [
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
