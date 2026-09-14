import AppKit
import WebKit

@main
@MainActor
struct PetHitRegionContract {
    static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        NSApp.finishLaunching()
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let handler = PetHitRegionHandler()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(handler, name: "petHitRegion")
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 135, height: 135), configuration: configuration)
        let window = NSWindow(contentRect: webView.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = webView
        window.ignoresMouseEvents = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.center()
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }

        var region = PetHitRegion()
        var received = 0
        var currentID = ""
        handler.onUpdate = { id, value in
            guard id == currentID else { return }
            region = value
            received += 1
        }

        func wait(_ condition: () -> Bool) {
            let deadline = Date().addingTimeInterval(10)
            while !condition(), Date() < deadline {
                if let event = NSApp.nextEvent(matching: .any, until: Date().addingTimeInterval(0.01), inMode: .default, dequeue: true) {
                    NSApp.sendEvent(event)
                }
                NSApp.updateWindows()
            }
            if !condition() {
                webView.evaluateJavaScript("({ready:document.readyState, parts:document.querySelectorAll('#torso').length, width:innerWidth, height:innerHeight, visibility:document.visibilityState})") { value, error in
                    FileHandle.standardError.write(Data("Diagnostic: \(String(describing: value)) \(String(describing: error))\n".utf8))
                }
                RunLoop.main.run(until: Date().addingTimeInterval(1))
            }
            precondition(condition(), "WebKit contour update timed out, received=\(received)")
        }

        func load(_ source: String, side: CGFloat = 135, mirrored: Bool = false, motion: Bool = false) {
            FileHandle.standardError.write(Data("Loading \(source) mini=\(side) mirror=\(mirrored) motion=\(motion)\n".utf8))
            currentID = UUID().uuidString
            window.setContentSize(NSSize(width: side, height: side))
            webView.frame = NSRect(x: 0, y: 0, width: side, height: side)
            let html = CharacterRenderer.html(repoRoot: root, source: "src/animations/\(source).svg",
                                              motion: motion, mirrored: mirrored)!
            let count = received
            webView.loadHTMLString(html.html + PetHitRegion.script(documentID: currentID, mirrored: mirrored), baseURL: html.baseURL)
            wait { received > count }
        }

        func mutate(_ script: String) {
            let count = received
            webView.evaluateJavaScript(script)
            wait { received > count }
        }

        // Independent body silhouette in SVG units; sample every screen pixel, including
        // the gaps above/below arms and between legs, not just a few bounding-box points.
        let body = [CGRect(x: 2, y: 6, width: 11, height: 7),
                    CGRect(x: 0, y: 9, width: 2, height: 2), CGRect(x: 13, y: 9, width: 2, height: 2)]
            + [3, 5, 9, 11].map { CGRect(x: $0, y: 13, width: 1, height: 2) }

        func verifyPixels(side: Int, mini: Bool = false, mirrored: Bool = false) {
            for y in 0..<side {
                for x in 0..<side {
                    let px = CGFloat(x) + 0.5, py = CGFloat(y) + 0.5
                    let svgX = (mirrored ? CGFloat(side) - px : px) / 3 - (mini ? 7 : 15)
                    let svgY = (CGFloat(side) - py) / 3 + (mini ? 3 : -25)
                    let expected = body.contains { $0.contains(CGPoint(x: svgX, y: svgY)) }
                    if region.contains(CGPoint(x: px, y: py), in: CGSize(width: side, height: side)) != expected {
                        var done = false
                        webView.evaluateJavaScript("JSON.stringify([...document.querySelectorAll('#torso,#outer-left-leg')].map(e=>({id:e.id,box:e.getBoundingClientRect().toJSON(),ctm:['a','b','c','d','e','f'].map(k=>e.getScreenCTM()[k])})))") { value, error in
                            FileHandle.standardError.write(Data("Geometry: \(String(describing: value))\n".utf8))
                            done = true
                        }
                        wait { done }
                    }
                    precondition(region.contains(CGPoint(x: px, y: py), in: CGSize(width: side, height: side)) == expected,
                                 "Contour mismatch at \(x),\(y), mini=\(mini), mirrored=\(mirrored)")
                }
            }
        }

        precondition(!region.contains(CGPoint(x: 60, y: 30), in: CGSize(width: 135, height: 135)),
                     "Unloaded regions must not fall back to the whole window")
        load("calm-calibration")
        verifyPixels(side: 135)
        load("calm-calibration", mirrored: true)
        verifyPixels(side: 135, mirrored: true)
        load("mini-idle", side: 48)
        verifyPixels(side: 48, mini: true)
        load("mini-idle", side: 48, mirrored: true)
        verifyPixels(side: 48, mini: true, mirrored: true)

        load("calm-calibration")
        func atSVG(_ x: CGFloat, _ y: CGFloat) -> Bool {
            region.contains(CGPoint(x: (x + 15) * 3, y: (20 - y) * 3), in: CGSize(width: 135, height: 135))
        }
        precondition(atSVG(1, 10))
        mutate("document.querySelector('.left-claw').style.transform = 'translateY(-4px)'")
        precondition(!atSVG(1, 10) && atSVG(1, 6), "Arm transforms must move the clickable contour")
        mutate("document.querySelector('.left-claw').style.opacity = '0'")
        precondition(!atSVG(1, 6), "Invisible limbs must not be clickable")

        // Sleeping has arms outside .actor. Props/Zs must not become clickable.
        load("blanket-burrito")
        precondition(atSVG(1, 10) && atSVG(14, 10))
        precondition(!atSVG(-1, 15) && !atSVG(16, 1))

        load("calm-calibration", motion: true)
        let initial = received
        wait { received > initial }

        let rotated = PetHitRegion(quads: [[0.5, 0.1, 0.9, 0.5, 0.5, 0.9, 0.1, 0.5]])
        precondition(rotated.contains(CGPoint(x: 50, y: 50), in: CGSize(width: 100, height: 100)))
        precondition(!rotated.contains(CGPoint(x: 15, y: 15), in: CGSize(width: 100, height: 100)),
                     "Rotated rectangles must not become bounding boxes")
        precondition(!rotated.contains(CGPoint(x: -1, y: 50), in: CGSize(width: 100, height: 100)))
        print("Pet hit region contract passed: full-pixel body/limb contours, gaps, mini, mirror, transforms, visibility, animation")
    }
}
