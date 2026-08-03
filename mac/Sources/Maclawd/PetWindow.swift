import AppKit
import WebKit

/**
 桌宠窗口：无边框、透明、常驻在普通窗口之上。

 用 WKWebView 渲染现有的 38 个 SVG，而不是转成图片序列——
 那些动画是 CSS 驱动的，WebKit 原生就能播，零资产转换、零重新导出。
 换成 NSImage 会丢掉全部动画。
 */
@MainActor
final class PetWindow: NSWindow {
    private let webView: WKWebView
    private var currentKey: String?
    private let repoRoot: URL
    var onDoubleClick: (() -> Void)?
    var onClick: (() -> Void)?
    /// 外壳事件回灌入口，由 AppDelegate 接到 RuntimeClient 上。
    var onShellEvent: ((String) -> Void)?
    private var trackingArea: NSTrackingArea?
    private var pointerMonitor: Any?

    // MARK: - 拖动状态

    /// 按下时的**屏幕**坐标，用来判断有没有超过拖动阈值。
    private var pressedAt: NSPoint?
    /// 光标落在窗口内的偏移，拖动时保持它不变，宠物才不会跳到光标下。
    private var grabOffset: NSPoint?
    /// 按下时的点击次数。真的发生拖动后清零——拖过就不再算点击。
    private var pendingClicks = 0
    private var isDragging = false
    /// 低于这个位移不算拖动。手抖几个点不该把「戳一下」变成「拎起来」。
    private let dragThreshold: CGFloat = 4
    private static let originKey = "petWindowOrigin"

    /// 贴住哪一边。mini 的动作是按**右边缘**画的，左边缘靠整体镜像复用，
    /// 不为左边缘另画一套资产。
    enum DockEdge { case none, left, right }
    private(set) var dockEdge: DockEdge = .none
    private(set) var isMini = false
    private let mainSize: CGFloat
    private let miniSize: CGFloat = 48

    /**
     主形态 135px 而不是 128px。

     取景是 45 单位：135 ÷ 45 = **3.000** px/单位，128 ÷ 45 = 2.844。
     非整数比下，1 单位宽的矩形（腿、眼睛）会因落点不同被渲成 2px 或 3px——
     45 个整数单位位置里有 7 个会掉到 2px，于是角色每做一次单位位移，
     轮廓宽度就变一次，看起来像在抖。Retina 2× 同理（270÷45=6.000）。

     135 与 128 只差 7pt，桌面上感知不到大小变化，但抖动会完全消失。
     */
    init(repoRoot: URL, size: CGFloat = 135) {
        self.repoRoot = repoRoot
        self.mainSize = size

        let config = WKWebViewConfiguration()
        config.suppressesIncrementalRendering = true
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: size, height: size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .clear }

        super.init(
            contentRect: NSRect(x: 0, y: 0, width: size, height: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        // .floating 浮在普通窗口之上但不压住系统 UI；桌宠不该盖住菜单或 Dock。
        level = .floating
        // 全空间可见，切桌面时桌宠跟着走。
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        isMovableByWindowBackground = false
        ignoresMouseEvents = false
        contentView = webView

        // 先试着回到上次拖到的地方；没有记录或那块屏幕已经不在了才回默认角落。
        if !restorePosition() { positionAtDefaultCorner() }
        startPointerTracking()
    }

    private func positionAtDefaultCorner() {
        guard let screen = hostScreen ?? NSScreen.main else { return }
        let inset: CGFloat = 32
        let area = screen.visibleFrame
        setFrameOrigin(NSPoint(x: area.maxX - frame.width - inset, y: area.minY + inset))
    }

    // MARK: - 命中区域

    /**
     角色本体在窗口里的归一化包围盒。

     取景是 45 单位，但**角色只占其中一小块**：横向 x0…15（含双爪）、
     纵向 y6…15（躯干顶到腿底）。换算下来 135px 的窗口里角色只有
     45×27px，**占面积 6.7%**——其余 93% 是透明的。

     这些数由 design/main-state-actions.json 的 characterContract 算出，
     test/motion-quality.test.js 会断言两边一致，改了契约这里不改就会挂。

     取景 `-15 -25 45 45`，AppKit 原点在左下而 SVG 的 y 向下，所以纵向要翻转：
       x: (0-(-15))/45 = 0.3333 … (15-(-15))/45 = 0.6667
       y: 1-(15-(-25))/45 = 0.1111 … 1-(6-(-25))/45 = 0.3111
     */
    private static let characterBox = (x0: 0.3333, x1: 0.6667, y0: 0.1111, y1: 0.3111)

    /// 抓取容差。角色只有 45×27px，一个像素不差地要求命中太苛刻——
    /// 但也不能给太多，给多了又回到「在空白处能拎起它」。
    private static let grabMargin: CGFloat = 6

    /// 角色在当前窗口坐标下的可抓取矩形。
    private var characterRect: NSRect {
        let b = Self.characterBox
        let side = frame.width
        let rect = NSRect(
            x: side * b.x0, y: side * b.y0,
            width: side * (b.x1 - b.x0), height: side * (b.y1 - b.y0)
        )
        return rect.insetBy(dx: -Self.grabMargin, dy: -Self.grabMargin)
    }

    /// 这个点落在角色身上吗？点在窗口坐标系里。
    private func hitsCharacter(_ point: NSPoint) -> Bool {
        // mini 档整个窗口就是角色（取景已经裁到只剩演员），不必再收
        if isMini { return true }
        return characterRect.contains(point)
    }

    /**
     让窗口的空白部分对鼠标透明。

     原本有一个 `clickThrough` 开关声明了这件事，但它默认 `false`、
     而且**全项目没有任何地方设置过它**——等于承诺了没做。
     后果是 93% 的透明区域照样吃掉点击：你想点桌宠底下的窗口，
     点不着；你以为点了空白，其实把桌宠拎了起来。

     这里改成跟着光标实时切换。必须用**全局**监听：
     `ignoresMouseEvents` 为真时窗口自己收不到 mouseMoved，
     只用窗口内的追踪区会一进入透明区就再也出不来。
     （鼠标类的全局监听不需要辅助功能权限，键盘才需要。）
     */
    private func startPointerTracking() {
        pointerMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDragged]
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.updatePassthrough() }
        }
    }

    private func updatePassthrough() {
        // 拖动途中绝不能改：一旦中途置为 true，后续的拖动事件会直接丢失，
        // 桌宠会停在半路上。
        guard !isDragging else { return }
        let cursor = NSEvent.mouseLocation
        let local = NSPoint(x: cursor.x - frame.minX, y: cursor.y - frame.minY)
        let onCharacter = frame.contains(cursor) && hitsCharacter(local)
        if ignoresMouseEvents != !onCharacter { ignoresMouseEvents = !onCharacter }
    }

    // MARK: - 渲染

    func show(source: String?, motion: Bool, variant: String? = nil) {
        // 变体也要参与去重键：同一个 SVG 在不同变体下显示不同数量的助手，
        // 只比对 source 会让变体切换不触发重渲染。
        // 镜像同理——贴左边和贴右边是同一个 source，漏掉它会导致换边不重绘。
        let key = "\(source ?? "")|\(variant ?? "")|\(motion)|\(dockEdge == .left)"
        guard let source, key != currentKey else {
            if source == nil { webView.loadHTMLString("", baseURL: nil) }
            return
        }
        currentKey = key

        let url = repoRoot.appendingPathComponent(source)
        guard let svg = try? String(contentsOf: url, encoding: .utf8) else { return }

        // 内联 SVG 而不是用 <img src=file://>：内联能确保 CSS 动画一定播放，
        // 也绕开本地文件访问权限问题。
        let reduced = motion ? "" : """
        <style>*{animation:none !important;transition:none !important}</style>
        """
        // 变体通过祖先元素的 data-variant 驱动共享样式表里的规则
        let variantAttr = variant.map { " data-variant=\"\($0)\"" } ?? ""
        // 贴左边时整体水平镜像。mini 的贴边位是按右边缘设计的（角色右半边
        // 被 viewBox 右界裁掉），镜像后左边缘得到完全对称的表现。
        let mirror = dockEdge == .left ? "transform:scaleX(-1);" : ""
        let html = """
        <!doctype html><meta charset="utf-8">
        <style>
          html,body{margin:0;height:100%;background:transparent;overflow:hidden}
          body{display:grid;place-items:center}
          svg{width:100%;height:100%;image-rendering:pixelated}
        </style>
        \(reduced)
        <div\(variantAttr) style="width:100%;height:100%;display:grid;place-items:center;\(mirror)">\(svg)</div>
        """
        webView.loadHTMLString(html, baseURL: url.deletingLastPathComponent())
    }

    // MARK: - 交互

    /**
     按下只记录，**不**立刻当成点击。

     此前 mouseDown 里无条件发 shell.click，于是每次拖动都会先播一遍
     Poke Squish（2.2 秒 oneshot），用户刚按下要拎起来，宠物先「被戳了一下」，
     点击动作和拖动动作打架。点击必须等到抬手、且确认没有发生拖动才算数——
     这是拖放的标准做法。
     */
    override func mouseDown(with event: NSEvent) {
        // 空白处按下不算数。ignoresMouseEvents 大多数时候已经拦住了，
        // 但它是跟着光标移动更新的——用键盘或脚本瞬移光标再按下时会来不及。
        guard hitsCharacter(event.locationInWindow) else { return }
        pressedAt = NSEvent.mouseLocation
        grabOffset = event.locationInWindow
        pendingClicks = event.clickCount
        isDragging = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = pressedAt, let offset = grabOffset else { return }
        let now = NSEvent.mouseLocation
        if !isDragging {
            let moved = max(abs(now.x - start.x), abs(now.y - start.y))
            guard moved >= dragThreshold else { return }
            isDragging = true
            // 已经是拖动了，抬手时不该再补一次点击
            pendingClicks = 0
            onShellEvent?("shell.dragStart")
        }
        // 保持光标与窗口的相对位置，宠物才是「被拎着」而不是「吸附到光标」
        setFrameOrigin(NSPoint(x: now.x - offset.x, y: now.y - offset.y))
    }

    override func mouseUp(with event: NSEvent) {
        defer {
            pressedAt = nil
            grabOffset = nil
            pendingClicks = 0
        }

        if isDragging {
            isDragging = false
            onShellEvent?("shell.drop")
            snapToEdgeIfNeeded()
            savePosition()
            return
        }

        // 没拖动才算点击。单击保持纯玩耍，不开面板——桌宠首先是宠物，不是按钮。
        if pendingClicks >= 2 {
            onShellEvent?("shell.doubleClick")
            onDoubleClick?()
        } else if pendingClicks == 1 {
            onShellEvent?("shell.click")
            onClick?()
        }
    }

    // MARK: - 位置记忆

    /// 窗口**中心所在**的屏幕。不能用 NSScreen.main——那是「有键盘焦点的屏幕」，
    /// 桌宠是不接受焦点的浮动窗口，拖到副屏后 main 仍然指主屏，
    /// 于是贴边判定会把它夹回主屏，副屏上根本放不住。
    private var hostScreen: NSScreen? {
        let center = NSPoint(x: frame.midX, y: frame.midY)
        return NSScreen.screens.first { $0.frame.contains(center) }
            ?? NSScreen.screens.first { $0.frame.intersects(frame) }
            ?? NSScreen.main
    }

    private func savePosition() {
        UserDefaults.standard.set(NSStringFromPoint(frame.origin), forKey: Self.originKey)
    }

    /**
     恢复上次的位置。

     必须校验它**仍然落在某块可见屏幕里**：存下来的位置可能来自已经拔掉的
     外接屏，直接用会让桌宠出现在看不见的地方——用户会以为应用没启动。
     校验不过就回默认角落。
     */
    @discardableResult
    private func restorePosition() -> Bool {
        guard let raw = UserDefaults.standard.string(forKey: Self.originKey) else { return false }
        let origin = NSPointFromString(raw)
        guard origin != .zero else { return false }
        let probe = NSRect(origin: origin, size: frame.size)
        guard NSScreen.screens.contains(where: { $0.visibleFrame.intersects(probe) }) else {
            return false
        }
        setFrameOrigin(origin)
        return true
    }

    /// 把桌宠移回默认角落。拖丢了、或者拖到已拔掉的屏幕上时的救命入口。
    func recenter() {
        positionAtDefaultCorner()
        savePosition()
        refreshTracking()
    }

    override func mouseEntered(with event: NSEvent) {
        onShellEvent?("shell.hover")
    }

    /// hover 是 held 模式：必须成对，否则「注视」会一直挂着不走。
    override func mouseExited(with event: NSEvent) {
        onShellEvent?("shell.hoverEnd")
    }

    /// 鼠标进入时才有 hover；窗口会移动，所以每次改变 frame 都要重建追踪区。
    func refreshTracking() {
        if let existing = trackingArea { contentView?.removeTrackingArea(existing) }
        guard let view = contentView else { return }
        // 追踪区跟着角色走，不是整个窗口。用 view.bounds 的话，
        // 光标停在桌宠上方 93px 的空白处就会触发「注视」——
        // 那里看起来什么都没有，用户不会明白它在看什么。
        let area = NSTrackingArea(
            rect: isMini ? view.bounds : characterRect,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        view.addTrackingArea(area)
        trackingArea = area
    }

    /// 要推出屏幕多远才算「想收起来」。太小会误触（用户只是想放到角落），
    /// 太大又推不动。宠物宽度的三分之一左右是个能做到、又做不错的量。
    private let pushThreshold: CGFloat = 40

    /**
     切换尺寸档。

     外壳**只提议不决定**：拖到边缘时发 `shell.miniEnter`，真正是不是 mini
     由运行时回的 `mini` 字段说了算。两边各存一份状态迟早对不上，
     而对不上的表现是窗口大小和动作尺寸档错配——非常难查。
     */
    func setMini(_ on: Bool) {
        guard on != isMini else { return }
        isMini = on
        let side = on ? miniSize : mainSize
        var origin = frame.origin
        if let screen = hostScreen {
            let visible = screen.visibleFrame
            // 收起时紧贴屏幕边（贴边位的裁切才成立），展开时把身子让回屏幕内。
            switch dockEdge {
            case .right: origin.x = visible.maxX - side
            case .left: origin.x = visible.minX
            case .none: break
            }
            origin.y = min(max(origin.y, visible.minY), visible.maxY - side)
        }
        setFrame(NSRect(origin: origin, size: NSSize(width: side, height: side)), display: true)
        currentKey = nil // 尺寸变了必须重绘
        refreshTracking()
    }

    /**
     松手后把身子收回屏幕内，并判断要不要收起成 mini。

     **收起需要明确意图**：只有把宠物**推出屏幕边缘**才收起，
     靠近边缘放下不算。此前是「落点距边缘 8pt 以内就收起」——
     那太容易误触，用户只是想把它挪到角落，它却缩成一半。
     推出屏幕外是一个不会误做的手势，语义上也正好是「把它塞到旁边去」。
     */
    private func snapToEdgeIfNeeded() {
        guard let screen = hostScreen else { return }
        let visible = screen.visibleFrame
        let origin = frame.origin
        let clampedX = min(max(origin.x, visible.minX), visible.maxX - frame.width)
        let clampedY = min(max(origin.y, visible.minY), visible.maxY - frame.height)

        // 被夹回来了多少 —— 这就是「推出去了多远」
        let pushedLeft = visible.minX - origin.x
        let pushedRight = origin.x - (visible.maxX - frame.width)
        let hitEdge = clampedX != origin.x || clampedY != origin.y
        setFrameOrigin(NSPoint(x: clampedX, y: clampedY))

        let edge: DockEdge = pushedLeft > pushThreshold ? .left
            : (pushedRight > pushThreshold ? .right : .none)
        if edge != .none, edge != dockEdge {
            dockEdge = edge
            currentKey = nil // 换边镜像变了，必须重绘
        }
        if hitEdge { onShellEvent?("shell.screenEdge") }
        onShellEvent?(edge == .none ? "shell.miniExit" : "shell.miniEnter")
    }

    deinit {
        if let monitor = pointerMonitor { NSEvent.removeMonitor(monitor) }
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
