import AppKit
import SwiftUI

/**
 额度提醒浮窗。

 ⚠️ **为什么是自绘而不是系统通知。**

 Maclawd 目前是 ad-hoc 签名（见 PROGRESS.md「Still not done」：没有
 Developer ID，`spctl --assess` 直接拒绝）。**ad-hoc 签名的应用发出的
 `UNUserNotification` 会被 macOS 静默丢弃**——不报错、不进通知中心、
 什么都没有。写成系统通知的话，表现是「提醒功能完全不工作」，
 而排查方向会全部指向代码，实际是签名问题。

 自绘 NSPanel 不挑签名，必弹。拿到 Developer ID 之后可以再加系统通知，
 但这条路要留着：开发期和 ad-hoc 分发都还得靠它。

 显示位置在右上角、4.5 秒后自动淡出、不抢焦点（`.nonactivatingPanel`），
 因为提醒是**告知**不是**打断**。
 */
@MainActor
enum QuotaAlertHUD {
    private static var panel: NSPanel?
    private static let width: CGFloat = 330
    private static let height: CGFloat = 92
    private static let dwell: TimeInterval = 4.5

    static func show(_ alerts: [QuotaAlert]) {
        guard let first = alerts.first else { return }
        let title = "\(first.sourceLabel) \(first.windowLabel)额度"
        var body = "已用 \(Int(first.usedPercent))%"
        if let until = Fmt.until(first.resetAt) { body += " · \(until)" }
        // 多个窗口同时越线时只弹一条，剩下的折成一句。
        // 连弹两三个浮窗比不提醒更烦。
        if alerts.count > 1 { body += "（另有 \(alerts.count - 1) 项）" }
        present(title: title, body: body, warn: first.usedPercent >= 90)
    }

    static func showTest() {
        present(title: "测试提醒", body: "额度提醒已就绪 ✓", warn: false)
    }

    private static func present(title: String, body: String, warn: Bool) {
        panel?.close()

        let view = QuotaAlertView(title: title, message: body, warn: warn)
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(x: 0, y: 0, width: width, height: height)

        let window = NSPanel(
            contentRect: host.frame,
            // .nonactivatingPanel：弹出来不抢焦点，用户在编辑器里打字不会被打断。
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.contentView = host

        if let screen = NSScreen.main {
            let area = screen.visibleFrame
            window.setFrameOrigin(NSPoint(x: area.maxX - width - 16, y: area.maxY - height - 16))
        }

        window.alphaValue = 0
        window.orderFrontRegardless()
        panel = window

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            window.animator().alphaValue = 1
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + dwell) {
            MainActor.assumeIsolated {
                NSAnimationContext.runAnimationGroup({ context in
                    context.duration = 0.35
                    window.animator().alphaValue = 0
                }, completionHandler: {
                    // completionHandler 是 @Sendable，静态属性不能直接在里面改。
                    // 它实际就在主线程上回调，所以再断言一次而不是把整条链染成 async。
                    MainActor.assumeIsolated {
                        window.close()
                        if panel === window { panel = nil }
                    }
                })
            }
        }
    }
}

private struct QuotaAlertView: View {
    let title: String
    let message: String
    let warn: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(LinearGradient(
                        colors: warn
                            ? [.orange, .orange.opacity(0.65)]
                            : [Color(nsColor: Design.bodyColor),
                               Color(nsColor: Design.bodyColor).opacity(0.65)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ))
                Image(systemName: "gauge.with.needle")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13, weight: .bold))
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(width: 330, height: 92, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color(nsColor: Design.accent).opacity(0.28), lineWidth: 0.75)
        )
    }
}
