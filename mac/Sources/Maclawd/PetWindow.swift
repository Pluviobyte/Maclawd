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
    private var dragOrigin: NSPoint?
    private let repoRoot: URL
    var onDoubleClick: (() -> Void)?
    var onClick: (() -> Void)?
    /// 外壳事件回灌入口，由 AppDelegate 接到 RuntimeClient 上。
    var onShellEvent: ((String) -> Void)?
    private var isDragging = false
    private var trackingArea: NSTrackingArea?

    /// 贴住哪一边。mini 的动作是按**右边缘**画的，左边缘靠整体镜像复用，
    /// 不为左边缘另画一套资产。
    enum DockEdge { case none, left, right }
    private(set) var dockEdge: DockEdge = .none
    private(set) var isMini = false
    private let mainSize: CGFloat
    private let miniSize: CGFloat = 48

    init(repoRoot: URL, size: CGFloat = 128) {
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

        positionAtDefaultCorner()
    }

    private func positionAtDefaultCorner() {
        guard let screen = NSScreen.main else { return }
        let inset: CGFloat = 32
        let frame = screen.visibleFrame
        setFrameOrigin(NSPoint(x: frame.maxX - self.frame.width - inset, y: frame.minY + inset))
    }

    /// 让桌宠只接受落在角色身上的点击，空白处点击穿透到下面的窗口。
    var clickThrough: Bool = false {
        didSet { ignoresMouseEvents = clickThrough }
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

    override func mouseDown(with event: NSEvent) {
        dragOrigin = event.locationInWindow
        // 单击保持纯玩耍，不开面板——桌宠首先是宠物，不是按钮。
        if event.clickCount == 2 {
            onShellEvent?("shell.doubleClick")
            onDoubleClick?()
        } else if event.clickCount == 1 {
            onShellEvent?("shell.click")
            onClick?()
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let origin = dragOrigin else { return }
        if !isDragging {
            isDragging = true
            onShellEvent?("shell.dragStart")
        }
        let location = NSEvent.mouseLocation
        setFrameOrigin(NSPoint(x: location.x - origin.x, y: location.y - origin.y))
    }

    override func mouseUp(with event: NSEvent) {
        dragOrigin = nil
        if isDragging {
            isDragging = false
            onShellEvent?("shell.drop")
        }
        snapToEdgeIfNeeded()
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
        let area = NSTrackingArea(
            rect: view.bounds,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        view.addTrackingArea(area)
        trackingArea = area
    }

    /// 判定「贴住了」的容差。比原来的 4pt 略宽——拖到边缘时手很难精确到 4pt，
    /// 太严会让收起功能看起来时灵时不灵。
    private let snapThreshold: CGFloat = 8

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
        if let screen = NSScreen.main {
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

    /// 贴边时轻微内收，避免半个身子跑到屏幕外；真正贴到边就报 screenEdge，
    /// 并按落点在左还是在右提议收起 / 展开。
    private func snapToEdgeIfNeeded() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        var origin = frame.origin
        let clampedX = min(max(origin.x, visible.minX), visible.maxX - frame.width)
        let clampedY = min(max(origin.y, visible.minY), visible.maxY - frame.height)
        let atLeft = abs(clampedX - visible.minX) < snapThreshold
        let atRight = abs(clampedX - (visible.maxX - frame.width)) < snapThreshold
        let hitEdge = clampedX != origin.x || clampedY != origin.y || atLeft || atRight
        origin.x = clampedX
        origin.y = clampedY
        setFrameOrigin(origin)

        let edge: DockEdge = atLeft ? .left : (atRight ? .right : .none)
        if edge != dockEdge {
            dockEdge = edge
            currentKey = nil // 换边镜像变了，必须重绘
        }
        if hitEdge { onShellEvent?("shell.screenEdge") }
        onShellEvent?(edge == .none ? "shell.miniExit" : "shell.miniEnter")
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
