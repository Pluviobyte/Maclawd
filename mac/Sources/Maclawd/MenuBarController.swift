import AppKit

/**
 菜单栏标记。

 ⚠️ 这是**功能占位实现**，不是最终设计资产。
 现有动作 QA 只覆盖 64px 与 96px；45×45 的像素角色缩到 22px 基本不可读，
 所以这里按角色几何合同重绘一枚极简标记：躯干 + 双爪 + 双眼 + 一个状态色点。
 真正的 5 档标记设计仍待设计所有者定稿，见 design/token-experience.md 待决事项 1。
 */
@MainActor
final class MenuBarController {
    private let item: NSStatusItem
    private let client: RuntimeClient
    private var density: Density
    var onTogglePet: (() -> Void)?
    /// 把桌宠移回默认角落。拖丢了、或者拖到已经拔掉的外接屏上时的救命入口——
    /// 没有它，用户只能去删 UserDefaults 或者重装。
    var onRecenterPet: (() -> Void)?
    var onQuit: (() -> Void)?
    /// 左键：开关面板。参数是菜单栏按钮本身——popover 要锚在它下面。
    var onTogglePanel: ((NSStatusBarButton) -> Void)?

    enum Density: String, CaseIterable {
        case iconOnly, todayTokens, todayCost, liveRate, quota
        var title: String {
            switch self {
            case .iconOnly: return "仅标记"
            case .todayTokens: return "今日 tokens"
            case .todayCost: return "今日成本"
            case .liveRate: return "实时速率"
            case .quota: return "订阅额度"
            }
        }

        static let defaultsKey = "menuBarDensity"

        static var current: Density {
            Density(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .todayTokens
        }

        /// 设置页也要能改，所以读写都走这里，不散落在两处。
        static func set(_ raw: String) {
            guard Density(rawValue: raw) != nil else { return }
            UserDefaults.standard.set(raw, forKey: defaultsKey)
            NotificationCenter.default.post(name: .maclawdDensityChanged, object: nil)
        }
    }

    init(client: RuntimeClient) {
        self.client = client
        self.density = Density.current
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageLeading

        /*
         左键 = 内容（面板），右键 = 命令（菜单）。

         这是菜单栏应用的标准拆分，同时治好一个既有缺陷：此前左键弹的是
         NSMenu，于是「今日 X 计费 · Y/min」只能表现成两行灰掉的禁用菜单项。
         拆开之后两边都能各自做好。

         注意不能再用 `item.menu = menu`——设了它 AppKit 会接管点击，
         button.action 根本不会被调用。
        */
        item.button?.target = self
        item.button?.action = #selector(handleClick(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        NotificationCenter.default.addObserver(
            self, selector: #selector(densityChangedExternally),
            name: .maclawdDensityChanged, object: nil
        )
        render()
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    // MARK: - 绘制

    /// 22px 高的标记，按锁定的源矩形等比映射。
    private func markImage(state: Design.MarkState) -> NSImage {
        let side: CGFloat = 18
        let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { _ in
            // 源坐标空间是 15 宽（0…15），映射到 side
            let scale = side / 16.0
            let px: (CGFloat) -> CGFloat = { $0 * scale }
            // AppKit 原点在左下，源坐标原点在左上，纵向翻转
            let flip: (CGFloat, CGFloat) -> CGFloat = { y, h in side - px(y) - px(h) }

            Design.bodyColor.setFill()
            let torso = Design.torso
            NSBezierPath(rect: CGRect(x: px(torso.minX), y: flip(torso.minY, torso.height),
                                      width: px(torso.width), height: px(torso.height))).fill()
            for arm in [Design.leftArm, Design.rightArm] {
                NSBezierPath(rect: CGRect(x: px(arm.minX), y: flip(arm.minY, arm.height),
                                          width: px(arm.width), height: px(arm.height))).fill()
            }
            for x in Design.legsX {
                NSBezierPath(rect: CGRect(x: px(x), y: flip(Design.legsY, 2),
                                          width: px(1), height: px(2))).fill()
            }

            // 睡着时闭眼：画一条横线代替竖眼，这是 sleeping 唯一的形态差异
            Design.eyeColor.setFill()
            for x in Design.eyesX {
                let rect = state.eyesClosed
                    ? CGRect(x: px(x), y: flip(Design.eyesY + 1, 1), width: px(1), height: max(1, px(0.5)))
                    : CGRect(x: px(x), y: flip(Design.eyesY, 2), width: px(1), height: px(2))
                NSBezierPath(rect: rect).fill()
            }

            if let dot = state.dot {
                dot.setFill()
                let size = px(3)
                NSBezierPath(ovalIn: CGRect(x: side - size, y: side - size, width: size, height: size)).fill()
            }
            return true
        }
        image.isTemplate = false
        return image
    }

    private func fmt(_ n: Int) -> String {
        if n >= 1_000_000_000 { return String(format: "%.2fB", Double(n) / 1e9) }
        if n >= 1_000_000 { return String(format: "%.2fM", Double(n) / 1e6) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1e3) }
        return String(n)
    }

    func render() {
        let state = Design.MarkState.from(actionId: client.state.actionId)
        item.button?.image = markImage(state: state)

        switch density {
        case .iconOnly:
            item.button?.title = ""
        case .todayTokens:
            item.button?.title = " \(fmt(client.usage.throughput))"
        case .todayCost:
            if let cost = client.usage.cost {
                item.button?.title = String(format: " $%.2f", cost)
            } else {
                item.button?.title = " —"
            }
        case .liveRate:
            item.button?.title = " \(fmt(client.state.tokensPerMin))/min"
        case .quota:
            // 显示**已用**，和 Claude Code 给的口径一致，不做翻转。
            if let used = client.quota.usedPercent {
                item.button?.title = " \(Int(used))%"
            } else {
                // 通道没装、或还没等到第一次 API 响应。显示 0% 会是假的。
                item.button?.title = " —"
            }
        }

        if client.state.disabled { item.button?.title = " 已关闭" }
        item.button?.toolTip = tooltip
        rebuildMenu()
    }

    /// popover 要锚的那个视图。双击桌宠也走它——面板始终从菜单栏长出来，
    /// 位置固定，用户不用去猜这次会从哪冒出来。
    var anchorView: NSStatusBarButton? { item.button }

    /// 悬停提示。额度档下要说清楚这个百分比是什么窗口的，
    /// 光一个「78%」在菜单栏上没有上下文。
    private var tooltip: String {
        var parts: [String] = []
        if !client.state.name.isEmpty { parts.append(client.state.name) }
        if let source = client.quota.sourceLabel,
           let label = client.quota.windowLabel,
           let used = client.quota.usedPercent {
            parts.append("\(source) · \(label) 已用 \(Int(used))%")
        }
        parts.append(client.state.actionId)
        return parts.joined(separator: " · ")
    }

    // MARK: - 点击分工

    /// 左键 = 面板，右键 = 命令菜单。
    @objc private func handleClick(_ sender: NSStatusBarButton) {
        let isRight = NSApp.currentEvent?.type == .rightMouseUp
            || NSApp.currentEvent?.modifierFlags.contains(.control) == true
        if isRight {
            showContextMenu(from: sender)
        } else {
            onTogglePanel?(sender)
        }
    }

    private func showContextMenu(from button: NSStatusBarButton) {
        let menu = buildMenu()
        // 用 popUpContextMenu 而不是 item.menu：设了 item.menu 之后
        // AppKit 会接管全部点击，button.action 根本不会触发，左键也就打不开面板了。
        NSMenu.popUpContextMenu(menu, with: NSApp.currentEvent ?? NSEvent(), for: button)
    }

    @objc private func densityChangedExternally() {
        density = Density.current
        render()
    }

    // MARK: - 菜单

    private func rebuildMenu() {
        // 右键菜单是临时构建的（见 showContextMenu），这里只保留一个
        // 空实现的调用点，避免 render() 每次都白白建一棵菜单树。
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()

        if let error = client.lastError {
            let item = NSMenuItem(title: error, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
            menu.addItem(.separator())
        }

        menu.addItem(withTitle: "打开面板", action: #selector(openPanelFromMenu), keyEquivalent: "")
            .target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "显示 / 隐藏桌宠", action: #selector(togglePet), keyEquivalent: "p")
            .target = self
        menu.addItem(withTitle: "把桌宠移回角落", action: #selector(recenterPet), keyEquivalent: "r")
            .target = self
        menu.addItem(withTitle: "在浏览器里打开完整统计", action: #selector(openUsage), keyEquivalent: "u")
            .target = self

        menu.addItem(.separator())
        let densityMenu = NSMenu()
        for option in Density.allCases {
            let entry = NSMenuItem(title: option.title, action: #selector(setDensity(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = option.rawValue
            entry.state = option == density ? .on : .off
            densityMenu.addItem(entry)
        }
        let densityItem = NSMenuItem(title: "菜单栏显示", action: nil, keyEquivalent: "")
        densityItem.submenu = densityMenu
        menu.addItem(densityItem)

        let login = NSMenuItem(title: "登录时启动", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = LoginItem.isEnabled ? .on : .off
        menu.addItem(login)

        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Maclawd", action: #selector(quit), keyEquivalent: "q").target = self
        return menu
    }

    @objc private func togglePet() { onTogglePet?() }
    @objc private func recenterPet() { onRecenterPet?() }
    @objc private func openUsage() { NSWorkspace.shared.open(client.usageURL) }
    @objc private func openPanelFromMenu() {
        guard let button = item.button else { return }
        onTogglePanel?(button)
    }
    @objc private func quit() { onQuit?() }

    @objc private func setDensity(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let next = Density(rawValue: raw) else { return }
        density = next
        Density.set(raw)
        render()
    }

    @objc private func toggleLogin() {
        LoginItem.setEnabled(!LoginItem.isEnabled)
        rebuildMenu()
    }
}

private extension NSMenu {
    @discardableResult
    func addItem(withTitle title: String, action: Selector, keyEquivalent: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        addItem(item)
        return item
    }
}
