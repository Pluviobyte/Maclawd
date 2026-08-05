import AppKit

/**
 这里只识别 WorkBuddy 是否作为 macOS 应用注册；积分读取由 Node provider 负责。

 按 bundle identifier 查询 Launch Services，既能识别被用户移动过的应用，也不会
 把一个叫 `WorkBuddy.app` 的空目录误判为安装。该探针不接触登录 Token。
 */
enum WorkBuddyInstallationDetector {
    static let bundleIdentifier = "com.workbuddy.workbuddy"

    static func isInstalled(
        locateApplication: (String) -> URL? = {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0)
        }
    ) -> Bool {
        locateApplication(bundleIdentifier) != nil
    }
}
