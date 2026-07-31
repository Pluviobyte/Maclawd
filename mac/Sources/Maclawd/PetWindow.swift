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

    init(repoRoot: URL, size: CGFloat = 128) {
        self.repoRoot = repoRoot

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
        let key = "\(source ?? "")|\(variant ?? "")|\(motion)"
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
        let html = """
        <!doctype html><meta charset="utf-8">
        <style>
          html,body{margin:0;height:100%;background:transparent;overflow:hidden}
          body{display:grid;place-items:center}
          svg{width:100%;height:100%;image-rendering:pixelated}
        </style>
        \(reduced)
        <div\(variantAttr) style="width:100%;height:100%;display:grid;place-items:center">\(svg)</div>
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

    /// 贴边时轻微内收，避免半个身子跑到屏幕外；真正贴到边就报 screenEdge。
    private func snapToEdgeIfNeeded() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        var origin = frame.origin
        let clampedX = min(max(origin.x, visible.minX), visible.maxX - frame.width)
        let clampedY = min(max(origin.y, visible.minY), visible.maxY - frame.height)
        let hitEdge = clampedX != origin.x || clampedY != origin.y
            || abs(clampedX - visible.minX) < 4 || abs(clampedX - (visible.maxX - frame.width)) < 4
        origin.x = clampedX
        origin.y = clampedY
        setFrameOrigin(origin)
        if hitEdge { onShellEvent?("shell.screenEdge") }
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
