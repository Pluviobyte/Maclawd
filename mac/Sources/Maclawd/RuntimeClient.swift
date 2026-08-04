import CoreGraphics
import Darwin
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
    /// 这个动作要不要让窗口跟着位移（自发溜达）。单位是 pt。
    var drift: (dx: CGFloat, dy: CGFloat)?
    var reason: String = ""
    /// 发起当前这个状态的进程。点桌宠跳回那个终端窗口时用。
    /// nil 表示当前画面不属于任何会话（静默链、自发行为、外壳交互）。
    var focusPid: pid_t?
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

/// 菜单栏要的额度摘要。完整结构在 PanelModel.swift 里，这里只留最紧的那个窗口——
/// 菜单栏放不下更多，也不该放。
struct QuotaBrief: Equatable {
    var usedPercent: Double?
    var sourceLabel: String?
    var windowLabel: String?
    var resetAt: Date?
    /// 通道装没装。菜单栏据此决定「显示 —」还是干脆不显示这一档。
    var available: Bool = false
}

/**
 状态引擎的唯一实现留在 Node 侧，Swift 只做渲染。

 这不是偷懒——把状态机在 Swift 里重写一遍就有了两份实现，
 两份实现必然漂移，而漂移的表现是「桌宠的动作和面板的数字对不上」，
 那种 bug 极难定位。所以外壳通过 127.0.0.1 消费同一个引擎。

 外壳负责把 Node 运行时作为子进程带起来，用户不需要自己开终端。
 */
@MainActor
final class RuntimeClient: ObservableObject {
    /// 运行时**实际**监听的端口。首选端口被占时它会往后找，
    /// 然后把结果写进端点文件——外壳跟着文件走，不自己假设。
    private var port: Int
    private let preferredPort: Int
    private var process: Process?
    /// 长轮询的游标。服务端只在画面**真的变了**时才把它推进，
    /// 所以带着它去问等于说「我停在这一帧，变了叫我」。
    private var stateVersion = 0
    private var streamTask: URLSessionDataTask?
    private var streamStopped = true
    private var streamBackoff: TimeInterval = 0
    private let session: URLSession
    private let repoRoot: URL
    private var startupInProgress = false
    private var runtimeReady = false
    private let expectedProtocolVersion = 1

    // @Published 让 SwiftUI 面板直接观察同一份状态，不用再复制一套。
    // 全部赋值都收敛到主线程（见 refresh），此前它们是在 URLSession 的
    // 回调线程上直接改的——菜单栏读到半个快照不会崩，但 SwiftUI 会。
    @Published private(set) var state = RuntimeState()
    @Published private(set) var usage = UsageSnapshot()
    @Published private(set) var quota = QuotaBrief()
    @Published private(set) var lastError: String?

    /// 待弹的额度提醒。判定在 Node 侧（按 resetAt 每周期一次），
    /// 外壳只负责弹和回执——两份去重逻辑必然漂移，漂移的表现是重复打扰用户。
    @Published private(set) var pendingAlerts: [QuotaAlert] = []

    var onUpdate: (() -> Void)?

    /// 面板要用同一个端口。端口会随 endpoint 文件变（4173 被占时会换）。
    var currentPort: Int { port }

    init(repoRoot: URL, port: Int = 4173) {
        self.repoRoot = repoRoot
        self.port = port
        self.preferredPort = port
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

    /// 运行时日志。**不能再往 /dev/null 倒。**
    ///
    /// 之前子进程的 stdout/stderr 都接的是 nullDevice，于是端口被占这类
    /// 会打死运行时的错误彻底不可见——用户看到的只是「桌宠不动」，
    /// 没有任何线索能自查。日志落到数据目录下，菜单里可以一键打开。
    var logURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("Maclawd/runtime.log")
    }

    private func openLogHandle() -> FileHandle? {
        let url = logURL
        let fm = FileManager.default
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // 每次启动截断重开：我们要的是「这次为什么没起来」，不是历史归档。
        // 留着追加的话，一个反复重启的运行时能把日志写到几百兆。
        fm.createFile(atPath: url.path, contents: nil)
        return try? FileHandle(forWritingTo: url)
    }

    func startRuntime() {
        guard process == nil, !startupInProgress, !runtimeReady else { return }
        guard let node = findNode() else {
            lastError = "未找到 node。Maclawd 的采集运行时需要 Node ≥ 20。"
            return
        }
        let script = repoRoot.appendingPathComponent("bin/maclawd-usage.js")
        guard FileManager.default.fileExists(atPath: script.path) else {
            lastError = "未找到 \(script.path)"
            return
        }

        startupInProgress = true
        guard let endpoint = readRuntimeEndpoint() else {
            launchRuntime(node: node, script: script)
            return
        }
        probeRuntime(endpoint: endpoint) { [weak self] ping in
            guard let self else { return }
            let legacyProcess = RuntimeProcessInspector.inspect(pid: endpoint.pid)
            let decision = RuntimeStartupCoordinator.decide(
                endpoint: endpoint,
                ping: ping,
                expectedProtocolVersion: self.expectedProtocolVersion,
                expectedBuildId: self.expectedBuildId(),
                endpointProcessAlive: self.processExists(endpoint.pid),
                legacyProcess: legacyProcess,
                expectedNodePath: node,
                expectedScriptPath: script.path,
                expectedPreferredPort: self.preferredPort
            )
            self.applyStartupDecision(decision, node: node, script: script)
        }
    }

    private func launchRuntime(node: String, script: URL) {
        startupInProgress = true

        let task = Process()
        task.executableURL = URL(fileURLWithPath: node)
        task.arguments = [script.path, "serve", String(preferredPort)]
        task.currentDirectoryURL = repoRoot
        var environment = ProcessInfo.processInfo.environment
        environment["MACLAWD_RUNTIME_BUILD_ID"] = expectedBuildId()
        task.environment = environment
        if let log = openLogHandle() {
            task.standardOutput = log
            task.standardError = log
        }
        // 运行时自己会挑一个空闲端口并写进端点文件；退出码告诉我们它为什么没起来。
        task.terminationHandler = { [weak self] proc in
            guard let self else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard self.process === proc else { return }
                    self.process = nil
                    self.runtimeReady = false
                    self.startupInProgress = false
                    guard proc.terminationStatus != 0 else { return }
                    let hint: String
                    switch proc.terminationStatus {
                    case 3: hint = "已有另一个 Maclawd 在运行"
                    case 4: hint = "端口全被占用"
                    default: hint = "退出码 \(proc.terminationStatus)"
                    }
                    self.lastError = "采集运行时已退出（\(hint)）。详见 runtime.log"
                }
            }
        }
        do {
            try task.run()
            process = task
            runtimeReady = true
            startupInProgress = false
            lastError = nil
            // 状态流跟着运行时一起起。头一两次必然连不上（node 还在启动），
            // 退避重连正是为这一段准备的——不需要在外面猜一个"等多久"。
            startStateStream()
        } catch {
            startupInProgress = false
            runtimeReady = false
            lastError = "启动运行时失败: \(error.localizedDescription)"
        }
    }

    func stopRuntime() {
        stopStateStream()
        process?.terminate()
        process = nil
        runtimeReady = false
        startupInProgress = false
    }

    private func expectedBuildId() -> String {
        let manifest = repoRoot.appendingPathComponent("runtime-build.json")
        if let data = try? Data(contentsOf: manifest),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let build = json["buildId"] as? String, !build.isEmpty {
            return build
        }
        let package = repoRoot.appendingPathComponent("package.json")
        if let data = try? Data(contentsOf: package),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let version = json["version"] as? String {
            return "dev-\(version)"
        }
        return "dev-unknown"
    }

    private func readRuntimeEndpoint() -> RuntimeEndpoint? {
        let url = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Maclawd/runtime-endpoint.json")
        guard let url,
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = (json["port"] as? NSNumber)?.intValue, port > 0,
              let pid = (json["pid"] as? NSNumber)?.int32Value, pid > 1
        else { return nil }
        return RuntimeEndpoint(
            port: port,
            pid: pid,
            protocolVersion: (json["protocolVersion"] as? NSNumber)?.intValue,
            buildId: json["buildId"] as? String,
            instanceId: json["instanceId"] as? String,
            managementToken: json["managementToken"] as? String
        )
    }

    private func processExists(_ pid: Int32) -> Bool {
        guard pid > 1 else { return false }
        if kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    private func probeRuntime(endpoint: RuntimeEndpoint, done: @escaping (RuntimePing?) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(endpoint.port)/api/ping") else {
            done(nil); return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        session.dataTask(with: request) { data, _, _ in
            let ping: RuntimePing? = data.flatMap { data in
                guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["maclawd"] as? Bool == true,
                      let pid = (json["pid"] as? NSNumber)?.int32Value,
                      let port = (json["port"] as? NSNumber)?.intValue
                else { return nil }
                return RuntimePing(
                    pid: pid,
                    port: port,
                    protocolVersion: (json["protocolVersion"] as? NSNumber)?.intValue,
                    buildId: json["buildId"] as? String,
                    instanceId: json["instanceId"] as? String
                )
            }
            DispatchQueue.main.async { MainActor.assumeIsolated { done(ping) } }
        }.resume()
    }

    private func applyStartupDecision(_ decision: RuntimeStartupDecision, node: String, script: URL) {
        switch decision {
        case .launch:
            launchRuntime(node: node, script: script)
        case .reuse(let actualPort):
            port = actualPort
            runtimeReady = true
            startupInProgress = false
            lastError = nil
            startStateStream()
        case .replaceManaged(let oldPort, let pid, let instanceId, let token):
            requestManagedShutdown(port: oldPort, instanceId: instanceId, token: token) { [weak self] accepted in
                guard let self else { return }
                guard accepted else {
                    self.startupInProgress = false
                    self.lastError = "旧运行时拒绝了已验证的替换请求，未强制终止。"
                    return
                }
                self.waitForRuntimeExit(port: oldPort, pid: pid, node: node, script: script)
            }
        case .replaceLegacy(let oldPort, let pid):
            guard kill(pid, SIGTERM) == 0 || errno == ESRCH else {
                startupInProgress = false
                lastError = "旧运行时身份已验证，但无法停止（errno \(errno)）。"
                return
            }
            waitForRuntimeExit(port: oldPort, pid: pid, node: node, script: script)
        case .untrusted(let reason):
            startupInProgress = false
            lastError = "发现无法安全接管的本地运行时：\(reason)。未终止该进程。"
        }
    }

    private func requestManagedShutdown(
        port: Int,
        instanceId: String,
        token: String,
        done: @escaping (Bool) -> Void
    ) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/runtime/shutdown") else {
            done(false); return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        session.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode
            let returnedId = data.flatMap {
                (try? JSONSerialization.jsonObject(with: $0) as? [String: Any])?["instanceId"] as? String
            }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { done(status == 202 && returnedId == instanceId) }
            }
        }.resume()
    }

    private func waitForRuntimeExit(
        port oldPort: Int,
        pid: Int32,
        node: String,
        script: URL,
        attemptsRemaining: Int = 30
    ) {
        let endpoint = RuntimeEndpoint(port: oldPort, pid: pid)
        probeRuntime(endpoint: endpoint) { [weak self] ping in
            guard let self else { return }
            if ping == nil {
                self.launchRuntime(node: node, script: script)
                return
            }
            guard ping?.pid == pid else {
                self.startupInProgress = false
                self.lastError = "替换旧运行时时端口被另一个进程接管，已停止操作。"
                return
            }
            guard attemptsRemaining > 0 else {
                self.startupInProgress = false
                self.lastError = "旧运行时在 3 秒内未退出，已停止替换。"
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.waitForRuntimeExit(
                    port: oldPort,
                    pid: pid,
                    node: node,
                    script: script,
                    attemptsRemaining: attemptsRemaining - 1
                )
            }
        }
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
        // 不阻塞 UI，但**响应不能丢**：它的响应体就是新画面。
        // 以前这里是 `{ _, _, _ in }`，于是点一下桌宠要等到下一次轮询
        // （最多 2 秒）才看到 Poke Squish——「点它没反应」就是这么来的。
        session.dataTask(with: request) { [weak self] data, _, _ in
            let json = data.flatMap {
                try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
            } ?? nil
            guard let json else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.apply(json) }
            }
        }.resume()
    }

    /// 端点文件（运行时写的）→ 实际端口。
    ///
    /// 每次 refresh 前对一遍，因为运行时可能在我们轮询的间隙重启并换了端口。
    /// 读一个几十字节的本地文件比一次失败的 HTTP 往返便宜得多。
    private func syncPortFromEndpoint() {
        let url = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Maclawd/runtime-endpoint.json")
        guard let url,
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let discovered = json["port"] as? Int, discovered > 0
        else { return }
        if discovered != port { port = discovered }
    }

    /// `/api/state` 的响应 → RuntimeState。
    ///
    /// 抽出来是因为现在有**三个**地方产生这份快照：长轮询、投事件的响应、
    /// 首次加载。三份解码必然漂移，而漂移的表现是「点一下和自己变化时
    /// 表现不一样」这种极难复现的 bug。
    private static func decodeState(_ json: [String: Any]) -> RuntimeState {
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
            if let d = p["drift"] as? [String: Any],
               let dx = (d["dx"] as? NSNumber)?.doubleValue,
               let dy = (d["dy"] as? NSNumber)?.doubleValue {
                next.drift = (CGFloat(dx), CGFloat(dy))
            }
        }
        if let f = json["focus"] as? [String: Any], let pid = f["pid"] as? Int, pid > 1 {
            next.focusPid = pid_t(pid)
        }
        next.mini = json["mini"] as? Bool ?? false
        if let d = json["debug"] as? [String: Any] {
            next.energy = d["energy"] as? Double ?? 1
            next.tokensPerMin = d["rate"] as? Int ?? 0
        }
        return next
    }

    /// 应用一份新快照。**必须已经在主线程上**——所有可变状态都归主 actor。
    ///
    /// 解码可以在后台做（纯函数），但赋值不行：URLSession 的回调在它自己的
    /// 队列上，直接改 stateVersion / streamBackoff 就是数据竞争。
    /// 编译器只给了警告，但这类竞争的表现是偶发的错帧，极难复现。
    @MainActor
    private func apply(_ json: [String: Any]) {
        var next = Self.decodeState(json)
        if let v = json["version"] as? Int { stateVersion = v }
        next.disabled = state.disabled
        state = next
        onUpdate?()
    }

    /**
     状态流：长轮询，不是定时拉。

     **原来的问题。** 引擎内部换状态只要 2ms，而这里每 2 秒才拉一次，
     于是用户看到的延迟是 0～2000ms（平均 1 秒）。那读起来就是「卡」——
     不是动画慢，是消息根本还没送到。

     长轮询把方向反过来：请求挂在服务端等，状态一变立刻返回。
     结果**又快又省**——变化时几十毫秒送达，不变时 25 秒才一个请求，
     比原来每 2 秒一次还少。

     失败时退避重连而不是紧循环：运行时重启的那几秒里，紧循环会打出
     几百个连不上的请求，还会把端点文件的重新发现挤掉。
     */
    private func streamState() {
        guard !streamStopped else { return }
        syncPortFromEndpoint()
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/state?since=\(stateVersion)") else { return }
        var request = URLRequest(url: url)
        // 必须长于服务端的 25 秒挂起，否则每次都是客户端先超时，
        // 长轮询退化成 30 秒一次的慢轮询。
        request.timeoutInterval = 40
        streamTask?.cancel()
        streamTask = session.dataTask(with: request) { [weak self] data, _, error in
            // 解析在后台做，改状态一律回主线程——见 apply 上方的说明。
            let json = data.flatMap {
                try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
            } ?? nil
            let failed = error != nil
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, !self.streamStopped else { return }
                    if let json {
                        self.apply(json)
                        self.streamBackoff = 0
                        self.streamState()
                        return
                    }
                    // 连不上（多半是运行时正在重启）：退避，最多 4 秒。
                    // 紧循环会在重启的那几秒里打出几百个连不上的请求。
                    if failed { self.streamBackoff = min(self.streamBackoff + 0.5, 4.0) }
                    let delay = max(self.streamBackoff, 0.2)
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        MainActor.assumeIsolated { self.streamState() }
                    }
                }
            }
        }
        streamTask?.resume()
    }

    func startStateStream() {
        streamStopped = false
        streamState()
    }

    func stopStateStream() {
        streamStopped = true
        streamTask?.cancel()
        streamTask = nil
    }

    func refresh() {
        syncPortFromEndpoint()
        // 画面本身走 streamState()。这里只管面板数字——它们是几秒级的量，
        // 用不着毫秒级，也不该跟着画面一起被唤醒。

        get("/api/live") { [weak self] json in
            guard let self, let json else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.state.tokensPerMin = json["tokensPerMin"] as? Int ?? 0
                    self.state.disabled = json["disabled"] as? Bool ?? false
                    self.onUpdate?()
                }
            }
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
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.usage = snapshot
                    self.onUpdate?()
                }
            }
        }

        get("/api/quota") { [weak self] json in
            guard let self, let json else { return }
            let snapshot = QuotaSnapshot.decode(json)
            // 菜单栏只放得下一个数字，取最紧的那个窗口。
            let tightest = snapshot.sources
                .flatMap { source in source.windows.map { (source, $0) } }
                .filter { !$0.1.isReset && $0.1.usedPercent != nil }
                .max { ($0.1.usedPercent ?? 0) < ($1.1.usedPercent ?? 0) }
            var brief = QuotaBrief()
            brief.available = !snapshot.empty
            brief.usedPercent = tightest?.1.usedPercent
            brief.sourceLabel = tightest?.0.label
            brief.windowLabel = tightest?.1.label
            brief.resetAt = tightest?.1.resetAt
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.quota = brief
                    self.onUpdate?()
                }
            }
        }

        get("/api/quota/alerts") { [weak self] json in
            guard let self, let json else { return }
            let alerts = (json["alerts"] as? [[String: Any]] ?? []).compactMap(QuotaAlert.init)
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.pendingAlerts = alerts
                    self.onUpdate?()
                }
            }
        }
    }

    /// 弹过之后回执，Node 侧才会记下「这个周期提醒过了」。
    /// 不回执就会每 2 秒重弹一次——这是最容易做错、也最惹人烦的一处。
    func acknowledge(alerts: [QuotaAlert]) {
        guard !alerts.isEmpty else { return }
        pendingAlerts = pendingAlerts.filter { pending in
            !alerts.contains(where: { $0.key == pending.key })
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/quota/alerts") else { return }

        // 拆开写：塞成一整条表达式时编译器要花几十秒去推断嵌套字典的类型。
        var payload: [[String: Any]] = []
        for alert in alerts {
            let resetMs: Double = alert.resetAt.map { $0.timeIntervalSince1970 * 1000 } ?? 0
            payload.append(["key": alert.key, "resetAt": resetMs])
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["acknowledged": payload])
        session.dataTask(with: request) { _, _, _ in }.resume()
    }
}
