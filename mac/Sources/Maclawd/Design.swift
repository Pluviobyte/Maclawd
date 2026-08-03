import AppKit

extension Notification.Name {
    /// 设置页与右键菜单都能改菜单栏密度，改完互相同步。
    static let maclawdDensityChanged = Notification.Name("maclawd.densityChanged")
}

/// 角色几何与配色合同。数值来自 design/main-state-actions.json 的 characterContract，
/// 与 SVG 资产是同一套真值——菜单栏标记必须和桌宠本体是同一只生物。
enum Design {
    static let bodyColor = NSColor(srgbRed: 0xDE / 255.0, green: 0x88 / 255.0, blue: 0x6D / 255.0, alpha: 1)
    static let eyeColor = NSColor.black
    static let accent = NSColor(srgbRed: 0xC6 / 255.0, green: 0x7A / 255.0, blue: 0x62 / 255.0, alpha: 1)

    /// 锁定的源矩形（45×45 view box 内的坐标）。
    static let torso = CGRect(x: 2, y: 6, width: 11, height: 7)
    static let leftArm = CGRect(x: 0, y: 9, width: 2, height: 2)
    static let rightArm = CGRect(x: 13, y: 9, width: 2, height: 2)
    static let legsX: [CGFloat] = [3, 5, 9, 11]
    static let legsY: CGFloat = 13
    static let eyesX: [CGFloat] = [4, 10]
    static let eyesY: CGFloat = 8

    /// 菜单栏标记只需要区分 5 档，不是全部 38 个动作。
    enum MarkState: String {
        case idle, working, needsOwner, error, sleeping

        /// 状态色点。idle 不点亮——常态不该有指示灯在闪。
        var dot: NSColor? {
            switch self {
            case .idle: return nil
            case .working: return NSColor.systemGreen
            case .needsOwner: return NSColor.systemOrange
            case .error: return NSColor.systemRed
            case .sleeping: return NSColor.systemGray
            }
        }

        var eyesClosed: Bool { self == .sleeping }

        /// 把 38 个动作 id 收敛到 5 档。
        static func from(actionId: String) -> MarkState {
            if actionId.hasPrefix("needs_owner") { return .needsOwner }
            if actionId.hasPrefix("error") { return .error }
            if actionId == "sleeping" || actionId == "away" { return .sleeping }
            if actionId.hasPrefix("working") || actionId.hasPrefix("thinking")
                || actionId.hasPrefix("delegating") || actionId.hasPrefix("compacting") {
                return .working
            }
            return .idle
        }
    }
}
