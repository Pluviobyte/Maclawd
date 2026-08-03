import SwiftUI
import WebKit

/**
 面板顶部那块角色。

 **它必须是 WKWebView。** 38 个动作全是 CSS 驱动的 SVG，重画成原生就等于
 把整套运动系统实现第二遍——那正是这个项目刻意不做的事
 （见 PetWindow 的头注释：零素材转换是架构上的赌注）。

 面板其余部分是原生 SwiftUI，只有这一块是网页。理由见
 design/quota-and-panel.md 第八节：暗色、毛玻璃、系统字体、VoiceOver
 在原生侧全是免费的，而角色在原生侧要重写一遍。

 两个坑写在这里，因为它们只在 popover 里才暴露：

 1. WKWebView 默认画不透明白底。不关掉 `drawsBackground`，
    毛玻璃面板里会嵌一块死白方块，看起来像渲染失败。
 2. 冷启动 200–400ms。所以这个 view 由 PanelController 在应用启动时就
    创建好并预热，而不是等用户点开菜单栏才建——那样会先看到空白再蹦出角色。
 */
struct CharacterStage: NSViewRepresentable {
    let repoRoot: URL
    /// 运行时下发的 `plan.source`，仓库相对路径。
    let source: String?
    let motion: Bool
    let variant: String?

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.suppressesIncrementalRendering = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { view.underPageBackgroundColor = .clear }
        // 面板里的角色纯展示：不接受任何鼠标交互，点击要穿到面板本身
        // （点角色 = 点面板，不该有网页的选中/拖拽行为）。
        view.setValue(false, forKey: "allowsMagnification")
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        let key = "\(source ?? "")|\(variant ?? "")|\(motion)"
        guard key != context.coordinator.currentKey else { return }
        context.coordinator.currentKey = key

        guard let source, let rendered = CharacterRenderer.html(
            repoRoot: repoRoot, source: source, motion: motion, variant: variant
        ) else {
            view.loadHTMLString("", baseURL: nil)
            return
        }
        view.loadHTMLString(rendered.html, baseURL: rendered.baseURL)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var currentKey: String = ""
    }
}
