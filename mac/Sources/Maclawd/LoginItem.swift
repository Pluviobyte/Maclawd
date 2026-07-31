import Foundation
import ServiceManagement

/// 登录时启动。macOS 13+ 用 SMAppService；更早的系统直接报不支持而不是假装成功。
enum LoginItem {
    static var isEnabled: Bool {
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }
        return false
    }

    static func setEnabled(_ enabled: Bool) {
        guard #available(macOS 13.0, *) else { return }
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            NSLog("Maclawd: 登录项设置失败 %@", error.localizedDescription)
        }
    }
}
