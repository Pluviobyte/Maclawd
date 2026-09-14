import CoreGraphics
import WebKit

/// SVG 当前帧的身体矩形经完整变换后组成轮廓；保存四边形，旋转时也不扩大成包围盒。
struct PetHitRegion {
    private var paths: [CGPath] = []

    init(quads: [[Double]] = []) {
        paths = quads.compactMap { quad in
            guard quad.count == 8, quad.allSatisfy(\.isFinite) else { return nil }
            let path = CGMutablePath()
            path.move(to: CGPoint(x: quad[0], y: quad[1]))
            for index in stride(from: 2, to: 8, by: 2) {
                path.addLine(to: CGPoint(x: quad[index], y: quad[index + 1]))
            }
            path.closeSubpath()
            return path
        }
    }

    func contains(_ point: CGPoint, in size: CGSize) -> Bool {
        guard size.width > 0, size.height > 0,
              CGRect(origin: .zero, size: size).contains(point) else { return false }
        // 浏览器左上原点 → AppKit 左下原点。归一化坐标同时支持主形态和 mini。
        let normalized = CGPoint(x: point.x / size.width, y: 1 - point.y / size.height)
        return paths.contains { $0.contains(normalized) }
    }

    /// 身体资产由无圆角、无描边的 rect 构成；从渲染 DOM 取几何，不复制动画或角色常量。
    static func script(documentID: String, mirrored: Bool = false) -> String {
        // ID 由 UUID 生成，只包含十六进制与连字符。
        """
        <script>
        (() => {
          // 睡眠动作的双臂在 actor 外；按身体部件 ID 取，排除眼睛、道具和助手。
          const parts = [...document.querySelectorAll(
            '#torso, #left-arm, #right-arm, #outer-left-leg, #inner-left-leg, #inner-right-leg, #outer-right-leg'
          )];
          let previous = '', lastTime = -Infinity;
          function frame(time) {
            requestAnimationFrame(frame);
            if (time - lastTime < 1000 / 30) return;
            lastTime = time;
            const quads = [];
            for (const part of parts) {
              let visible = true;
              for (let node = part; node instanceof Element; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) {
                  visible = false; break;
                }
              }
              const style = getComputedStyle(part);
              if (!visible || style.fill === 'none' || Number(style.fillOpacity) === 0) continue;
              // WebKit 的 getScreenCTM 在 HTML 祖先 scaleX(-1) 下会丢失反射符号。
              // 先取 SVG 视口内的矩阵，再应用渲染器的外层镜像，保留四边形形状。
              const matrix = part.getCTM();
              if (!matrix || !innerWidth || !innerHeight) continue;
              const viewport = part.ownerSVGElement.getBoundingClientRect();
              const {x, y, width, height} = part.getBBox();
              if (!width || !height) continue;
              quads.push([[x,y], [x+width,y], [x+width,y+height], [x,y+height]].flatMap(([px,py]) => {
                const p = new DOMPoint(px,py).matrixTransform(matrix);
                const screenX = \(mirrored ? "viewport.right - p.x" : "viewport.left + p.x");
                return [screenX / innerWidth, (viewport.top + p.y) / innerHeight];
              }));
            }
            const key = JSON.stringify(quads);
            if (key === previous) return;
            previous = key;
            window.webkit.messageHandlers.petHitRegion.postMessage({id:'\(documentID)', quads});
          }
          requestAnimationFrame(frame);
        })();
        </script>
        """
    }
}

/// WKUserContentController 强持有 handler；用闭包的弱引用避免把窗口一起留下。
@MainActor
final class PetHitRegionHandler: NSObject, WKScriptMessageHandler {
    var onUpdate: ((String, PetHitRegion) -> Void)?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let quads = body["quads"] as? [[Double]] else { return }
        onUpdate?(id, PetHitRegion(quads: quads))
    }
}
