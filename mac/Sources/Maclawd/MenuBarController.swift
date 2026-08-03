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

    enum Density: String, CaseIterable {
        case iconOnly, todayTokens, todayCost, liveRate
        var title: String {
            switch self {
            case .iconOnly: return "仅标记"
            case .todayTokens: return "今日 tokens"
            case .todayCost: return "今日成本"
            case .liveRate: return "实时速率"
            }
        }
    }

    init(client: RuntimeClient) {
        self.client = client
        self.density = Density(rawValue: UserDefaults.standard.string(forKey: "menuBarDensity") ?? "")
            ?? .todayTokens
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageLeading
        rebuildMenu()
        render()
    }

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
            item.button?.title = " \(fmt(client.usage.billable))"
        case .todayCost:
            if let cost = client.usage.cost {
                item.button?.title = String(format: " $%.2f", cost)
            } else {
                item.button?.title = " —"
            }
        case .liveRate:
            item.button?.title = " \(fmt(client.state.tokensPerMin))/min"
        }

        if client.state.disabled { item.button?.title = " 已关闭" }
        item.button?.toolTip = client.state.name.isEmpty
            ? client.state.actionId
            : "\(client.state.name) · \(client.state.actionId)"
        rebuildMenu()
    }

    // MARK: - 菜单

    private func rebuildMenu() {
        let menu = NSMenu()

        let header = NSMenuItem(
            title: client.state.name.isEmpty ? "Maclawd" : client.state.name,
            action: nil, keyEquivalent: ""
        )
        header.isEnabled = false
        menu.addItem(header)

        let detail = NSMenuItem(
            title: client.state.disabled
                ? "用量记录已关闭"
                : "今日 \(fmt(client.usage.billable)) 计费 · \(client.state.tokensPerMin)/min",
            action: nil, keyEquivalent: ""
        )
        detail.isEnabled = false
        menu.addItem(detail)

        if let error = client.lastError {
            let item = NSMenuItem(title: error, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        menu.addItem(.separator())
        menu.addItem(withTitle: "显示 / 隐藏桌宠", action: #selector(togglePet), keyEquivalent: "p")
            .target = self
        menu.addItem(withTitle: "把桌宠移回角落", action: #selector(recenterPet), keyEquivalent: "r")
            .target = self
        menu.addItem(withTitle: "打开用量统计…", action: #selector(openUsage), keyEquivalent: "u")
            .target = self
        menu.addItem(withTitle: "打开宠物管理…", action: #selector(openPanel), keyEquivalent: ",")
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

        item.menu = menu
    }

    @objc private func togglePet() { onTogglePet?() }
    @objc private func recenterPet() { onRecenterPet?() }
    @objc private func openUsage() { NSWorkspace.shared.open(client.usageURL) }
    @objc private func openPanel() { NSWorkspace.shared.open(client.panelURL) }
    @objc private func quit() { onQuit?() }

    @objc private func setDensity(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let next = Density(rawValue: raw) else { return }
        density = next
        UserDefaults.standard.set(raw, forKey: "menuBarDensity")
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
