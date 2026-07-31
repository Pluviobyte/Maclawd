#!/usr/bin/env swift
import AppKit
import Foundation

/**
 生成 Maclawd 的应用图标。

 按角色几何合同（design/main-state-actions.json 的 characterContract）程序化绘制，
 而不是手工画一张图——这样图标与桌宠本体**必然**是同一只生物，
 契约改了重跑一次即可，不会出现「图标和角色对不上」的漂移。

 用法：swift make-icon.swift  → 产出 AppIcon.icns
 */

let bodyColor = NSColor(srgbRed: 0xDE / 255.0, green: 0x88 / 255.0, blue: 0x6D / 255.0, alpha: 1)
let bgTop = NSColor(srgbRed: 0xF7 / 255.0, green: 0xF3 / 255.0, blue: 0xEC / 255.0, alpha: 1)
let bgBottom = NSColor(srgbRed: 0xEA / 255.0, green: 0xE2 / 255.0, blue: 0xD6 / 255.0, alpha: 1)

// 锁定的源矩形，与 Design.swift / SVG 资产同源
let torso = CGRect(x: 2, y: 6, width: 11, height: 7)
let arms = [CGRect(x: 0, y: 9, width: 2, height: 2), CGRect(x: 13, y: 9, width: 2, height: 2)]
let legsX: [CGFloat] = [3, 5, 9, 11]
let eyesX: [CGFloat] = [4, 10]

func drawIcon(size: CGFloat) -> NSImage {
    NSImage(size: NSSize(width: size, height: size), flipped: false) { _ in
        // macOS 图标习惯留出圆角边距，角色占中间那块
        let radius = size * 0.2237          // 与系统 squircle 接近
        let bg = NSBezierPath(roundedRect: CGRect(x: 0, y: 0, width: size, height: size),
                              xRadius: radius, yRadius: radius)
        let gradient = NSGradient(starting: bgTop, ending: bgBottom)
        gradient?.draw(in: bg, angle: -90)

        // 角色区域：16 单位宽的源坐标映射到中间 62%
        let inset = size * 0.19
        let field = size - inset * 2
        let unit = field / 16.0
        let px: (CGFloat) -> CGFloat = { inset + $0 * unit }
        // AppKit 原点在左下，源坐标原点在左上
        let flip: (CGFloat, CGFloat) -> CGFloat = { y, h in size - inset - (y + h) * unit }

        bodyColor.setFill()
        NSBezierPath(rect: CGRect(x: px(torso.minX), y: flip(torso.minY, torso.height),
                                  width: torso.width * unit, height: torso.height * unit)).fill()
        for arm in arms {
            NSBezierPath(rect: CGRect(x: px(arm.minX), y: flip(arm.minY, arm.height),
                                      width: arm.width * unit, height: arm.height * unit)).fill()
        }
        for x in legsX {
            NSBezierPath(rect: CGRect(x: px(x), y: flip(13, 2),
                                      width: unit, height: 2 * unit)).fill()
        }

        NSColor.black.setFill()
        for x in eyesX {
            NSBezierPath(rect: CGRect(x: px(x), y: flip(8, 2),
                                      width: unit, height: 2 * unit)).fill()
        }
        return true
    }
}

func png(_ image: NSImage, _ pixels: Int) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { return nil }
    rep.size = NSSize(width: pixels, height: pixels)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

let fm = FileManager.default
let iconset = "AppIcon.iconset"
try? fm.removeItem(atPath: iconset)
try fm.createDirectory(atPath: iconset, withIntermediateDirectories: true)

// iconutil 要求的完整尺寸集
let variants: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

for (name, pixels) in variants {
    guard let data = png(drawIcon(size: CGFloat(pixels)), pixels) else {
        FileHandle.standardError.write("生成 \(name) 失败\n".data(using: .utf8)!)
        exit(1)
    }
    try data.write(to: URL(fileURLWithPath: "\(iconset)/\(name).png"))
}

let convert = Process()
convert.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
convert.arguments = ["-c", "icns", iconset, "-o", "AppIcon.icns"]
try convert.run()
convert.waitUntilExit()
try? fm.removeItem(atPath: iconset)

if convert.terminationStatus == 0 {
    print("已生成 AppIcon.icns")
} else {
    FileHandle.standardError.write("iconutil 失败\n".data(using: .utf8)!)
    exit(1)
}
