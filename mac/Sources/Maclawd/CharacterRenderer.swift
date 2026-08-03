import Foundation

/**
 把一个动作 SVG 变成可以塞进 WKWebView 的 HTML。

 **这里只能有一份实现。** 桌宠窗口和面板都要渲染同一只角色，而这段代码里
 藏着一个已经咬过一次的坑：

 素材靠 `<?xml-stylesheet?>` 引共享样式表。那是 **XML 的处理指令**——
 把 SVG 内联进 HTML 文档之后，HTML 解析器会把它当成伪注释直接忽略，
 **样式表根本不会加载**，于是每个动作都只显示静态基准姿势。
 桌宠曾经一动不动整整一版就是这个原因：animation-name 恒为 none。

 所以样式表必须真正内联进来。这条如果在面板里再踩一次，
 表现会是「桌宠在动、面板里的它不动」——一个更难联想到原因的症状。
 */
enum CharacterRenderer {
    /// 共享样式表读一次就够——它在包内是只读的。
    private static var stylesheetCache: [String: String] = [:]

    private static func sharedStylesheet(near assetURL: URL) -> String {
        let cssURL = assetURL.deletingLastPathComponent()
            .appendingPathComponent("maclawd-actions.css")
        if let cached = stylesheetCache[cssURL.path] { return cached }
        let text = (try? String(contentsOf: cssURL, encoding: .utf8)) ?? ""
        stylesheetCache[cssURL.path] = text
        return text
    }

    /**
     - Parameters:
       - source:   仓库相对路径，来自运行时下发的 `plan.source`
       - motion:   false 时冻结全部动画（reduced motion）
       - variant:  通过祖先元素的 `data-variant` 驱动共享样式表里的规则
       - mirrored: 贴左边时整体水平镜像
     - Returns: 可直接 `loadHTMLString` 的文档；素材读不到时返回 nil
     */
    static func html(
        repoRoot: URL,
        source: String,
        motion: Bool,
        variant: String? = nil,
        mirrored: Bool = false
    ) -> (html: String, baseURL: URL)? {
        let url = repoRoot.appendingPathComponent(source)
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }

        let svg = raw.replacingOccurrences(
            of: "<?xml-stylesheet type=\"text/css\" href=\"maclawd-actions.css\"?>",
            with: ""
        )
        let sheet = sharedStylesheet(near: url)
        let reduced = motion ? "" : """
        <style>*{animation:none !important;transition:none !important}</style>
        """
        let variantAttr = variant.map { " data-variant=\"\($0)\"" } ?? ""
        let mirror = mirrored ? "transform:scaleX(-1);" : ""

        let document = """
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
        return (document, url.deletingLastPathComponent())
    }
}
