import AppKit
import WebKit

/**
 桌宠窗口：无边框、透明、常驻在普通窗口之上。

 用 WKWebView 渲染现有的 38 个 SVG，而不是转成图片序列——
 那些动画是 CSS 驱动的，WebKit 原生就能播，零资产转换、零重新导出。
 换成 NSImage 会丢掉全部动画。
 */
/**
 承载 webView 的容器。

 **桌宠一直拖不动的真正原因**：contentView 直接就是 WKWebView，
 而 WKWebView 是个正常的响应者，会自己吃掉 mouseDown / mouseDragged
 去处理网页内容。事件永远到不了 NSWindow 的 mouseDown——
 拖拽代码一直都在，只是从来没被调用过。而且没有任何报错，
 表现就是「点它没反应」，最难查的那种。

 这里把命中权收回来：落在角色身上就返回容器自己（不实现鼠标方法，
 事件顺着响应链交给窗口处理），落在空白处返回 nil。
 返回 nil 顺带解决了空白区吃掉点击的问题，而且**不需要任何全局监听**——
 之前那版用全局监听切 ignoresMouseEvents，把整个输入弄死了。
 */
@MainActor
final class PetContentView: NSView {
    /// 由窗口注入：这个点（窗口坐标）落在角色身上吗。
    var hitsCharacter: ((NSPoint) -> Bool)?

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard hitsCharacter?(point) ?? true else { return nil }
        return self
    }
}

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

    /// 自发溜达的位移动画。同一个动作只走一次——运行时每 2 秒轮询一次，
    /// 不去重的话同一次溜达会被重复触发，宠物会一路滑出屏幕。
    private var driftTimer: Timer?
    private var driftKey: String?
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

        // webView 必须套在容器里：直接当 contentView 的话它会吃掉全部鼠标事件。
        let container = PetContentView(frame: NSRect(x: 0, y: 0, width: size, height: size))
        container.autoresizingMask = [.width, .height]
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        contentView = container

        // 先试着回到上次拖到的地方；没有记录或那块屏幕已经不在了才回默认角落。
        if !restorePosition() { positionAtDefaultCorner() }
        container.hitsCharacter = { [weak self] point in self?.hitsCharacter(point) ?? true }
    }

    private func positionAtDefaultCorner() {
        guard let screen = hostScreen ?? NSScreen.main else { return }
        let inset: CGFloat = 32
        let area = screen.visibleFrame
        setFrameOrigin(NSPoint(x: area.maxX - frame.width - inset, y: area.minY + inset))
    }

    // MARK: - 命中区域

    /**
     命中区与可见画面框，**由运行时按契约算好下发**。

     此前这里硬编码四个归一化小数，靠一条测试盯着它和 characterContract 一致。
     那能防漂移，但挡不住第二个问题：命中框需要**按动作变化**——
     俯视平躺的 sleeping 比站立扁得多，用同一个框会让「点得到点不到」
     变得没道理，而外壳并不知道当前在演哪个动作的几何。
     所以改成随 plan 下发，Swift 里一个几何常量都不留。

     nil 表示还没收到（启动头一两秒）或处于 mini 档（整个窗口就是角色）。
     */
    private var hitBox: NormalizedRect?
    private var marginBox: NormalizedRect?

    /// 抓取容差。角色只有 45×27px，一个像素不差地要求命中太苛刻——
    /// 但也不能给太多，给多了又回到「在空白处能拎起它」。
    private static let grabMargin: CGFloat = 6

    /// 运行时下发的几何。窗口尺寸变化时命中区跟着变，所以要重建追踪区。
    func applyGeometry(hit: NormalizedRect?, margin: NormalizedRect?) {
        let changed = hit?.x0 != hitBox?.x0 || hit?.y0 != hitBox?.y0
            || hit?.x1 != hitBox?.x1 || hit?.y1 != hitBox?.y1
        hitBox = hit
        marginBox = margin
        if changed { refreshTracking() }
    }

    /// 角色在当前窗口坐标下的可抓取矩形。
    private var characterRect: NSRect {
        guard let hitBox else { return NSRect(origin: .zero, size: frame.size) }
        return hitBox.rect(in: frame.width).insetBy(dx: -Self.grabMargin, dy: -Self.grabMargin)
    }

    /// 可见画面在当前窗口坐标下的矩形。夹到屏幕内时用它。
    private var contentRect: NSRect {
        guard let marginBox else { return NSRect(origin: .zero, size: frame.size) }
        return marginBox.rect(in: frame.width)
    }

    /// 这个点落在角色身上吗？点在窗口坐标系里。
    private func hitsCharacter(_ point: NSPoint) -> Bool {
        // mini 档整个窗口就是角色（取景已经裁到只剩演员），不必再收
        if isMini { return true }
        return characterRect.contains(point)
    }

    /**
     **不做**动态的点击穿透。

     曾经在这里用 NSEvent.addGlobalMonitorForEvents 跟着光标切换
     ignoresMouseEvents，想让 93% 的透明区域把点击透给下面的窗口。
     结果是把主功能弄坏了：**全局监听不接收发给自己应用的事件**，
     一旦 ignoresMouseEvents 被置为 true，恢复它所需要的那个事件
     可能永远等不到，于是窗口再也收不到任何鼠标输入——桌宠彻底拖不动，
     而且没有任何报错，只是「点它没反应」。

     命中收窄改由两处**不依赖任何全局状态**的手段完成，各自都能独立验证：
       - 追踪区收到角色包围盒 → hover 不再在 93px 外误触发
       - mouseDown 判定命中 → 空白处按下不会把它拎起来
     代价是空白处的点击仍然被窗口吃掉（透不到下面）。那是个锦上添花，
     不值得拿主功能去换。真要做，得用能独立验证的机制，而不是全局监听。
     */
    // MARK: - 渲染

    /// 共享样式表的内容。读一次就够——它在包内是只读的。
    private var stylesheetCache: String?

    private func sharedStylesheet(near assetURL: URL) -> String {
        if let cached = stylesheetCache { return cached }
        let css = assetURL.deletingLastPathComponent()
            .appendingPathComponent("maclawd-actions.css")
        let text = (try? String(contentsOf: css, encoding: .utf8)) ?? ""
        stylesheetCache = text
        return text
    }

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
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return }

        // 素材靠 `<?xml-stylesheet?>` 引共享样式表。那是 **XML 的处理指令**——
        // 把 SVG 内联进 HTML 文档后，HTML 解析器会把它当成伪注释直接忽略，
        // **样式表根本不会加载**，于是每个动作都只显示静态基准姿势。
        // 桌宠一直不动就是这个原因：animation-name 恒为 none。
        // 所以这里必须把样式表内容真正内联进来，不能指望那条指令。
        // （同一个坑在 scripts/motion-check.html 里踩过一次并写了注释，
        //   当时没意识到外壳走的是同一条路。）
        let svg = raw.replacingOccurrences(
            of: "<?xml-stylesheet type=\"text/css\" href=\"maclawd-actions.css\"?>",
            with: ""
        )
        let sheet = sharedStylesheet(near: url)
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
        <style>\(sheet)</style>
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
        // NSScreen.screens 在插拔显示器、锁屏解锁、切换用户时会**短暂返回空**。
        // 那一刻拿 screens[0] 会崩，拿 NSScreen.main 也可能是 nil——
        // clawd-on-desk 的 work-area.js 就为这个挂过一个 issue。
        // 这里逐级退：中心命中 → 有交集 → 距离最近 → 主屏。
        let screens = NSScreen.screens
        guard !screens.isEmpty else { return NSScreen.main }
        let center = NSPoint(x: frame.midX, y: frame.midY)
        if let hit = screens.first(where: { $0.frame.contains(center) }) { return hit }
        if let overlap = screens.first(where: { $0.frame.intersects(frame) }) { return overlap }
        // 都不沾边（位置来自已拔掉的屏幕）——挑几何上最近的那块，而不是主屏，
        // 这样多屏摆位下「最近」比「主」更符合直觉。
        return screens.min { a, b in squaredDistance(center, a.frame) < squaredDistance(center, b.frame) }
            ?? NSScreen.main
    }

    private func squaredDistance(_ point: NSPoint, _ rect: NSRect) -> CGFloat {
        let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
        let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
        return dx * dx + dy * dy
    }

    /**
     位置连同**它所在那块显示器的快照**一起存。

     只存坐标是不够的，此前的校验是「这个位置还和某块屏幕相交吗」，
     两个方向都会判错：
       - 同一块显示器还在、但窗口略微越界 → 整个丢弃位置，跳回默认角落
       - 那块显示器被拔了、位置碰巧和另一块屏相交 → 保留一个错误的位置

     正确的问题是「**那块物理显示器还在不在**」。主判据是边界完全相等
     （同origin同分辨率几乎必然是同一块），次判据是 displayID
     （macOS 上跨会话稳定，但重排显示器时会变，所以只作次选）。
     这是 clawd-on-desk 的 buildDisplaySnapshot / findMatchingDisplay 思路。
     */
    private func savePosition() {
        var payload: [String: Any] = [
            "x": Double(frame.origin.x),
            "y": Double(frame.origin.y),
        ]
        if let screen = hostScreen {
            let b = screen.frame
            payload["display"] = [
                "x": Double(b.origin.x), "y": Double(b.origin.y),
                "w": Double(b.width), "h": Double(b.height),
                "id": screen.displayID.map(Double.init) ?? -1,
            ]
        }
        UserDefaults.standard.set(payload, forKey: Self.originKey)
    }

    /// 快照对应的显示器还在不在。边界完全相等优先，其次 displayID。
    private func matchingScreen(_ snapshot: [String: Any]) -> NSScreen? {
        guard let d = snapshot["display"] as? [String: Any] else { return nil }
        let want = NSRect(
            x: d["x"] as? Double ?? .nan, y: d["y"] as? Double ?? .nan,
            width: d["w"] as? Double ?? .nan, height: d["h"] as? Double ?? .nan
        )
        guard !want.origin.x.isNaN, want.width > 0 else { return nil }
        if let exact = NSScreen.screens.first(where: { $0.frame == want }) { return exact }
        if let id = d["id"] as? Double, id >= 0 {
            return NSScreen.screens.first { $0.displayID.map(Double.init) == id }
        }
        return nil
    }

    /**
     恢复上次的位置。

     那块显示器还在 → **信任存下来的坐标，即使朴素的夹取会推动它**
     （用户可能就是故意把它靠在边上的）。
     不在了 → 返回 false，交给默认角落。
     */
    @discardableResult
    private func restorePosition() -> Bool {
        guard let saved = UserDefaults.standard.dictionary(forKey: Self.originKey),
              let x = saved["x"] as? Double, let y = saved["y"] as? Double
        else { return false }

        // 没有显示器快照（旧版本存的）→ 退回到「还看得见吗」这个弱校验
        guard saved["display"] != nil else {
            let probe = NSRect(origin: NSPoint(x: x, y: y), size: frame.size)
            guard NSScreen.screens.contains(where: { $0.visibleFrame.intersects(probe) }) else {
                return false
            }
            setFrameOrigin(probe.origin)
            return true
        }

        guard matchingScreen(saved) != nil else { return false }
        setFrameOrigin(NSPoint(x: x, y: y))
        return true
    }

    /**
     让窗口跟着动作位移（自发溜达）。

     **不做这件事的话「走路」就是假的**：退役掉的 Sideways Scuttle
     就是因为外壳从不发 shell.move，那个动作一次都没在屏幕上出现过。

     - 同一个动作只触发一次（用 key 去重）。运行时每 2 秒轮询，
       不去重的话一次溜达会被重复触发，宠物一路滑出屏幕。
     - 拖动中不接受：用户正拎着它，程序再去移动会打架。
     - 目标位置先夹回屏幕内再走，走到边上就自然停下，不会走出去。
     */
    func applyDrift(_ drift: (dx: CGFloat, dy: CGFloat)?, key: String, durationMs: Int) {
        guard let drift, !isDragging, key != driftKey else {
            if drift == nil { driftKey = nil }
            return
        }
        driftKey = key
        driftTimer?.invalidate()

        guard let screen = hostScreen else { return }
        let visible = screen.visibleFrame
        let start = frame.origin
        // 朝屏幕内侧走：贴右边就往左溜达，否则往右。撞墙掉头比走出屏幕自然。
        let towardLeft = start.x + frame.width / 2 > visible.midX
        let target = NSPoint(
            x: min(max(start.x + (towardLeft ? -drift.dx : drift.dx), visible.minX),
                   visible.maxX - frame.width),
            y: min(max(start.y + drift.dy, visible.minY), visible.maxY - frame.height)
        )
        guard abs(target.x - start.x) > 1 || abs(target.y - start.y) > 1 else { return }

        // 分帧推进而不是一步到位——一步到位是「瞬移」，和走路动画对不上。
        let steps = max(1, durationMs / 40)
        var step = 0
        driftTimer = Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self, !self.isDragging else { timer.invalidate(); return }
                step += 1
                let t = min(1, Double(step) / Double(steps))
                self.setFrameOrigin(NSPoint(
                    x: start.x + (target.x - start.x) * t,
                    y: start.y + (target.y - start.y) * t
                ))
                if t >= 1 {
                    timer.invalidate()
                    self.savePosition()
                }
            }
        }
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

    /// 允许挂在工作区外的比例。按**可见画面**的尺寸算，不是窗口。
    /// 完全不许出界的话，桌宠没法真正靠到屏幕边上「待着」；
    /// 允许太多又会让它半个身子失踪。四分之一是 clawd-on-desk 用的量，试下来合适。
    private static let looseFraction: CGFloat = 0.25

    /**
     松手后把身子收回屏幕内，并判断要不要收起成 mini。

     **按可见画面夹，不是按窗口框。** 窗口 135×135 而角色只占 45×27，
     按窗口硬夹的话角色右侧永远离屏幕边至少 45px——桌宠根本贴不到边。
     这是抄 clawd-on-desk 的 marginBox 思路：夹的是画面的边界，
     窗口那一大圈透明区域该出界就出界。

     **收起需要明确意图**：只有把**画面**推出屏幕边缘才收起，靠近不算。
     此前是「窗口落点距边缘 8pt 以内就收起」，太容易误触——
     用户只是想把它挪到角落，它却缩成一半。
     */
    private func snapToEdgeIfNeeded() {
        guard let screen = hostScreen else { return }
        let visible = screen.visibleFrame
        let content = contentRect
        let origin = frame.origin

        // 画面在屏幕坐标下的边界
        let contentMinX = origin.x + content.minX
        let contentMaxX = origin.x + content.maxX
        let contentMinY = origin.y + content.minY
        let contentMaxY = origin.y + content.maxY

        let looseX = content.width * Self.looseFraction
        let looseY = content.height * Self.looseFraction

        // 夹的是画面，换算回窗口原点
        var nextX = origin.x
        var nextY = origin.y
        if contentMinX < visible.minX - looseX { nextX = visible.minX - looseX - content.minX }
        if contentMaxX > visible.maxX + looseX { nextX = visible.maxX + looseX - content.maxX }
        if contentMinY < visible.minY - looseY { nextY = visible.minY - looseY - content.minY }
        if contentMaxY > visible.maxY + looseY { nextY = visible.maxY + looseY - content.maxY }

        let clamped = nextX != origin.x || nextY != origin.y
        setFrameOrigin(NSPoint(x: nextX, y: nextY))

        // 推出去了多远——按**画面**算，而不是窗口
        let pushedLeft = visible.minX - contentMinX
        let pushedRight = contentMaxX - visible.maxX
        let threshold = content.width * Self.looseFraction
        let edge: DockEdge = pushedLeft > threshold ? .left
            : (pushedRight > threshold ? .right : .none)
        if edge != .none, edge != dockEdge {
            dockEdge = edge
            currentKey = nil // 换边镜像变了，必须重绘
        }
        if clamped { onShellEvent?("shell.screenEdge") }
        onShellEvent?(edge == .none ? "shell.miniExit" : "shell.miniEnter")
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

extension NSScreen {
    /// CGDirectDisplayID。macOS 上跨会话稳定，但重排显示器时会变——
    /// 所以它只作为边界匹配失败后的次判据，不能当主键。
    var displayID: CGDirectDisplayID? {
        deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
    }
}
