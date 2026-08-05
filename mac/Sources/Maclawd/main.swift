import AppKit
import IOKit.ps
import Network

/**
 Maclawd macOS 外壳。

 职责边界很窄：**只做渲染与系统集成**。状态机、采集、聚合、计价全部留在 Node
 运行时里，外壳通过 127.0.0.1 消费同一个引擎（理由见 RuntimeClient 的注释）。

 分发形态是 Developer ID + DMG、不启用沙盒——因为要读 `~/.claude` 等目录，
 一旦沙盒化就必须让用户走文件选择授权，「默认开启」立刻不成立
 （见 design/token-tracking.md「连带约束」）。
 */
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var client: RuntimeClient!
    private var menuBar: MenuBarController!
    private var pet: PetWindow!
    private var panel: PanelController!
    private var permissionCards: PermissionCardController!
    private var timer: Timer?
    private var petVisible = true
    private var monitor: NWPathMonitor?
    private var lastLowBattery = false
    private var lastOnline = true

    // MARK: - 存在感知
    //
    // 人在不在 ≠ agent 忙不忙。睡眠链此前完全由 agent 的沉默驱动，
    // 于是「你在读代码、agent 没事做」和「你出门了」被当成同一件事。
    // 光标位置是最便宜的存在证据：NSEvent.mouseLocation 不需要任何权限
    // （键盘要辅助功能授权，那会破坏「装上就能用」）。
    private var lastCursor: NSPoint?
    private var lastPresenceSent: Date?
    /// 小于这个距离算抖动，不算人动了。触控板的静止漂移能有一两像素。
    private let cursorMoveThreshold: CGFloat = 3
    /// 人一直在的时候没必要每 2 秒报一次——away 阈值是分钟级的，
    /// 20 秒的精度绰绰有余，而请求量少一个数量级。
    private let presenceThrottle: TimeInterval = 20

    /// 仓库根目录：开发时是 mac/ 的上一级；打包后是 .app 内的 Resources/runtime。
    private func resolveRepoRoot() -> URL {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("runtime"),
           FileManager.default.fileExists(atPath: bundled.appendingPathComponent("bin/maclawd-usage.js").path) {
            return bundled
        }
        // swift run 时可执行文件在 mac/.build/<config>/Maclawd
        var url = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        for _ in 0..<6 {
            url = url.deletingLastPathComponent()
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("bin/maclawd-usage.js").path) {
                return url
            }
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let root = resolveRepoRoot()

        client = RuntimeClient(repoRoot: root)
        client.startRuntime()

        pet = PetWindow(repoRoot: root)
        panel = PanelController(client: client, repoRoot: root)
        permissionCards = PermissionCardController(port: { [weak self] in self?.client.currentPort ?? 4173 })
        permissionCards.petFrame = { [weak self] in self?.pet.frame }
        permissionCards.start()
        panel.onOpenBrowser = { [weak self] path in
            guard let self, let url = URL(string: "http://127.0.0.1:\(self.client.currentPort)\(path)")
            else { return }
            NSWorkspace.shared.open(url)
        }
        panel.onQuit = { NSApp.terminate(nil) }
        // 菜单栏被折叠时退到桌宠身上（见 PanelController.usableAnchor）。
        panel.fallbackAnchor = { [weak self] in self?.pet.contentView }

        // 双击桌宠开面板。此前这里是 `NSWorkspace.shared.open(usageURL)`——
        // 弹一个 Safari 窗口出来，会切走焦点，和「瞥一眼」完全不是一回事。
        pet.onDoubleClick = { [weak self] in
            guard let self, let anchor = self.menuBar.anchorView else { return }
            self.panel.toggle(relativeTo: anchor)
        }
        // 缺失已久的回路：外壳的交互事件回灌状态引擎。
        // 单击：桌宠在**等你**的时候，点它就跳回那个终端窗口。
        //
        // 严格限定在这三个状态里。任何时候单击都跳窗口会很讨厌——
        // 你戳它玩一下，前台应用就换了。只有它主动在要你的时候，
        // 「点一下」才读得懂是「好，我来」。其余时候单击照旧只有 Poke Squish。
        pet.onClick = { [weak self] in
            guard let self else { return }
            let waiting = ["needs_owner", "error", "waiting"]
            guard waiting.contains(where: { self.client.state.actionId.hasPrefix($0) }),
                  let pid = self.client.state.focusPid
            else { return }
            TerminalFocus.activate(pid: pid)
        }
        pet.onShellEvent = { [weak self] type in
            self?.client.send(shellEvent: type)
        }
        pet.refreshTracking()

        menuBar = MenuBarController(client: client)
        menuBar.onTogglePet = { [weak self] in self?.togglePet() }
        menuBar.onRecenterPet = { [weak self] in
            self?.pet.recenter()
            self?.pet.orderFront(nil)
        }
        menuBar.onQuit = { NSApp.terminate(nil) }
        menuBar.onTogglePanel = { [weak self] anchor in
            self?.panel.toggle(relativeTo: anchor)
        }

        client.onUpdate = { [weak self] in
            guard let self else { return }
            self.menuBar.render()
            self.fireQuotaAlertsIfNeeded()
            // 尺寸档要先切：窗口还是 128 却在播 mini 资产，角色会缩在角落里。
            self.pet.setMini(self.client.state.mini)
            // 几何随动作变（sleeping 的命中框比站立扁），所以每次刷新都要跟上。
            self.pet.applyGeometry(hit: self.client.state.hitBox,
                                   margin: self.client.state.marginBox)
            self.pet.show(source: self.client.state.source,
                          motion: self.client.state.motion,
                          variant: self.client.state.variant)
            // 位移要在 show 之后：先换上走路的画面，再开始挪窗口。
            // 反过来的话会先看到「静止的宠物在滑动」。
            //
            // 面板开着时不让它溜达：菜单栏被折叠时面板就锚在桌宠身上
            // （见 PanelController.usableAnchor），桌宠一挪，面板跟着滑走——
            // 用户正在看数字，画面自己在飘。
            if !self.panel.isShown {
                self.pet.applyDrift(self.client.state.drift,
                                    key: self.client.state.source ?? "",
                                    durationMs: self.client.state.durationMs ?? 3000)
            }
        }

        pet.orderFront(nil)

        // 运行时刚起来需要一点时间监听，首刷延后一点。
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            MainActor.assumeIsolated { self?.client.refresh() }
        }
        // Timer 回调在主 run loop 上，assumeIsolated 是成立的断言而不是逃逸。
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.client.refresh()
                self?.checkBattery()
                self?.checkPresence()
            }
        }
        startNetworkMonitor()

        // 调试用：直接把面板弹出来。面板是 popover，没有这个开关就只能靠
        // 手点菜单栏，跑不了任何自动化验证。等运行时起来再弹，否则拍到的
        // 是一屏「连接中…」。
        if CommandLine.arguments.contains(where: { $0.hasPrefix("--show-panel") }) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, let anchor = self.menuBar.anchorView else { return }
                    self.panel.show(relativeTo: anchor)
                    if CommandLine.arguments.contains("--debug-range-probe") {
                        self.panel.startRangeProbe()
                    }
                }
            }
        }
    }

    /**
     额度提醒。

     判定（阈值、按 resetAt 每周期一次）全在 Node 侧，这里只负责弹和回执。
     两份去重逻辑必然漂移，而漂移的表现是重复打扰用户——桌宠打断人
     是最容易讨人嫌的行为，宁可少做。

     **不在桌宠正演 error / needs_owner 时插入**：那时用户已经有事要处理了，
     再叠一个浮窗是添乱。等它回到别的状态再说，提醒不会丢——
     Node 侧没收到回执就一直算「待弹」。
     */
    private func fireQuotaAlertsIfNeeded() {
        let alerts = client.pendingAlerts
        guard !alerts.isEmpty else { return }
        let action = client.state.actionId
        guard !action.hasPrefix("error"), !action.hasPrefix("needs_owner") else { return }

        QuotaAlertHUD.show(alerts)
        client.acknowledge(alerts: alerts)
    }

    /// 低电量 → Low Battery Droop；接上电源 → Morning Stretch。
    /// 只在**跨越阈值**时报一次，否则每 2 秒会刷一遍同一个状态。
    private func checkBattery() {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let sources = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef]
        else { return }

        for source in sources {
            guard let info = IOPSGetPowerSourceDescription(blob, source)?
                .takeUnretainedValue() as? [String: Any] else { continue }
            guard let current = info[kIOPSCurrentCapacityKey as String] as? Int,
                  let maximum = info[kIOPSMaxCapacityKey as String] as? Int, maximum > 0
            else { continue }
            let charging = (info[kIOPSPowerSourceStateKey as String] as? String) == kIOPSACPowerValue
            let low = !charging && Double(current) / Double(maximum) < 0.2

            if low != lastLowBattery {
                lastLowBattery = low
                client.send(shellEvent: low ? "shell.lowBattery" : "shell.powerConnected")
            }
            return
        }
    }

    /// 光标动了 → 人还在。
    ///
    /// 只报「动了」，不报「没动」——没有信号本身就是「可能不在」，
    /// 由引擎那边的时钟去判断多久算走了。这样离开期间一个请求都不发。
    private func checkPresence() {
        let now = NSEvent.mouseLocation
        defer { lastCursor = now }
        guard let previous = lastCursor else { return }   // 第一帧只记录，不判断
        let moved = hypot(now.x - previous.x, now.y - previous.y)
        guard moved >= cursorMoveThreshold else { return }

        if let sent = lastPresenceSent, Date().timeIntervalSince(sent) < presenceThrottle { return }
        lastPresenceSent = Date()
        client.send(shellEvent: "shell.presence")
    }

    /// 断网 → Signal Listen；恢复 → Ready Wiggle。
    private func startNetworkMonitor() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, online != self.lastOnline else { return }
                    self.lastOnline = online
                    self.client.send(shellEvent: online ? "shell.reconnected" : "shell.offline")
                }
            }
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility))
        self.monitor = monitor
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        monitor?.cancel()
        permissionCards?.stop()
        client?.stopRuntime()
    }

    private func togglePet() {
        petVisible.toggle()
        if petVisible {
            pet.orderFront(nil)
            pet.refreshTracking()
        } else {
            pet.orderOut(nil)
            client.send(shellEvent: "shell.paused")
        }
    }
}

// main.swift 的顶层代码不在 MainActor 上下文里，而 AppKit 全部要求主线程。
// 这里用 assumeIsolated 明确断言「我们确实在主线程」，而不是把整条链染成 async。
private enum Entry {
    static var retainedDelegate: AppDelegate?
}

let app = NSApplication.shared
MainActor.assumeIsolated {
    let delegate = AppDelegate()
    // 必须持有：NSApplication.delegate 是 weak 的。
    Entry.retainedDelegate = delegate
    app.delegate = delegate
    // 菜单栏应用：不占 Dock 图标。打包后由 Info.plist 的 LSUIElement 生效，
    // 这里再设一次让 `swift run` 直接调试时行为一致。
    app.setActivationPolicy(.accessory)
}
app.run()
