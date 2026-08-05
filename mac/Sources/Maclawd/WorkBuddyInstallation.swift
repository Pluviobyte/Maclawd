import AppKit

/**
 只识别 WorkBuddy 是否作为 macOS 应用注册，不读取它的账号或数据目录。

 按 bundle identifier 查询 Launch Services，既能识别被用户移动过的应用，也不会
 把一个叫 `WorkBuddy.app` 的空目录误判为安装。额度仍等待官方读取接口。
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
