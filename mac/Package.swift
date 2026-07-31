// swift-tools-version:5.9
import PackageDescription

// 刻意停在 tools-version 5.9：Swift 6 语言模式的严格并发检查会把这个
// 以 AppKit 主线程为中心的小程序逼成一堆 @Sendable 样板，收益为零。
let package = Package(
    name: "Maclawd",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Maclawd",
            path: "Sources/Maclawd"
        )
    ]
)
