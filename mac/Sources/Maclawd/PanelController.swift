import AppKit
import SwiftUI

/**
 面板容器。

 **为什么是 NSPopover 而不是无边框 NSPanel。** 箭头锚定、点外面自动消失、
 毛玻璃材质三样全是免费的，代价只有一条：弹出时应用会被激活，
 当前应用会失去键盘焦点。本应用是 `.accessory` 策略（main.swift），
 激活不会顶掉别人的菜单栏，所以这条代价可以接受。

 真要换成不抢焦点的 NSPanel，只需要换这个文件——内容层（PanelView）
 一行都不用动。

 **预热**：WKWebView 首次加载要 200–400ms。等用户点击才创建的话，
 会先看到一个空白面板再蹦出角色。所以在应用启动时就把 hosting controller
 建好，第一次点开是热的。
 */
@MainActor
final class PanelController {
    private let popover = NSPopover()
    private let store: PanelStore
    private let client: RuntimeClient

    var onOpenBrowser: ((String) -> Void)?
    var onQuit: (() -> Void)?
    /// 菜单栏图标不可用时锚到哪。见 usableAnchor 的说明。
    var fallbackAnchor: (() -> NSView?)?

    private var outsideClickMonitor: Any?

    init(client: RuntimeClient, repoRoot: URL) {
        self.client = client
        self.store = PanelStore(port: client.currentPort)

        let root = PanelView(
            client: client,
            store: store,
            repoRoot: repoRoot,
            onOpenBrowser: { [weak self] path in self?.onOpenBrowser?(path) },
            onQuit: { [weak self] in self?.onQuit?() }
        )
        let host = NSHostingController(rootView: root)
        // 高度跟着内容走；宽度在 PanelView 里固定成 360。
        host.sizingOptions = .preferredContentSize
        popover.contentViewController = host
        // .applicationDefined：自己控制关闭时机。默认的 .transient 会在
        // 点面板内部某些控件时也关掉，改开关都点不了。
        popover.behavior = .applicationDefined
        popover.animates = true

        // 预热：先把视图加载出来，用户第一次点开就是热的。
        _ = host.view
    }

    var isShown: Bool { popover.isShown }

    /**
     调试探针：按固定间隔轮换统计页的区间，并打印面板窗口框。

     「换区间面板不该动」没有别的自动化验证手段——popover 点不到，
     也没法从外部驱动 SwiftUI 的按钮。没有这个探针，这条只能靠肉眼看，
     而肉眼看不出 3pt 的漂移。
     */
    func startRangeProbe() {
        let ranges = ["today", "yesterday", "month", "week", "all"]
        var index = 0
        Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.popover.isShown else { return }
                let frame = self.popover.contentViewController?.view.window?.frame ?? .zero
                // 写 stderr 而不是 print：stdout 到管道是块缓冲的，
                // 进程被 kill 时那一批日志会整个丢掉，看起来像探针没跑。
                let line = "PROBE range=\(self.store.range.padding(toLength: 10, withPad: " ", startingAt: 0))"
                    + " origin=(\(Int(frame.origin.x)),\(Int(frame.origin.y)))"
                    + " size=\(Int(frame.width))x\(Int(frame.height))\n"
                FileHandle.standardError.write(Data(line.utf8))
                self.store.range = ranges[index % ranges.count]
                index += 1
            }
        }
    }

    func toggle(relativeTo view: NSView) {
        if popover.isShown { close() } else { show(relativeTo: view) }
    }

    func show(relativeTo view: NSView) {
        guard !popover.isShown else { return }
        store.updatePort(client.currentPort)
        store.start()
        store.loadSettings()
        let anchor = usableAnchor(preferred: view)
        popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .minY)
        installOutsideClickMonitor()
    }

    /**
     菜单栏图标不一定在屏幕上。

     **实测踩到**：这台机器的菜单栏已经挤满，系统把 Maclawd 的图标折进了
     溢出区（菜单栏右侧那个 `‹`）。`item.button` 仍然存在、也仍然能收到点击，
     但它的屏幕位置在可见区域之外，于是 `popover.show(relativeTo:of:)`
     把面板扔到了屏幕最左边——看起来像面板「飞出去了」。

     菜单栏挤满在真实机器上很常见（还有 Bartender / Ice 这类工具主动折叠），
     所以这不是边缘情况。锚点不可用时退到桌宠身上：它一定在屏幕上，
     而且面板从桌宠旁边长出来本身就说得通。
     */
    private func usableAnchor(preferred: NSView) -> NSView {
        if isOnScreen(preferred) { return preferred }
        if let fallback = fallbackAnchor?(), isOnScreen(fallback) { return fallback }
        return preferred
    }

    private func isOnScreen(_ view: NSView) -> Bool {
        guard let window = view.window, window.isVisible else { return false }
        let inWindow = view.convert(view.bounds, to: nil)
        let onScreen = window.convertToScreen(inWindow)
        guard onScreen.width > 1, onScreen.height > 1 else { return false }
        return NSScreen.screens.contains { $0.frame.intersects(onScreen) }
    }

    /// 面板关掉就停止轮询——它拉的数据比桌宠那份重得多，
    /// 没人看的时候不该继续做。
    func close() {
        guard popover.isShown else { return }
        popover.performClose(nil)
        store.stop()
        removeOutsideClickMonitor()
    }

    /**
     点面板外面关掉。

     `.applicationDefined` 不会自己关，所以要自己监听。这里**两个监听都要装**：
     全局监听收不到发给本应用自己的事件（PetWindow 的注释里记着这个坑
     的另一种表现），所以点桌宠窗口时得靠 local 那个。
     */
    private func installOutsideClickMonitor() {
        removeOutsideClickMonitor()
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown]
        let global = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] _ in
            MainActor.assumeIsolated { self?.close() }
        }
        let local = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            // local monitor 保证在主线程上。NSEvent 不是 Sendable，
            // 所以不能让它穿过 assumeIsolated 的边界——只把 Bool 带出来。
            let clickedOutside = MainActor.assumeIsolated { () -> Bool in
                guard let self, self.popover.isShown else { return false }
                // 面板自己窗口里的点击不算「点外面」
                return !PanelWindowScope.contains(
                    clicked: event.window,
                    root: self.popover.contentViewController?.view.window
                )
            }
            if clickedOutside {
                MainActor.assumeIsolated { self?.close() }
            }
            return event
        }
        outsideClickMonitor = [global as Any, local as Any]
    }

    private func removeOutsideClickMonitor() {
        if let monitors = outsideClickMonitor as? [Any] {
            for monitor in monitors { NSEvent.removeMonitor(monitor) }
        }
        outsideClickMonitor = nil
    }
}
