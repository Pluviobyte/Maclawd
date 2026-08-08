import Foundation

/**
 用户主动退出后留下一个小标记，让 agent hook 明白「没在跑」是用户的选择，
 不是需要自动修复的异常。用户下次自己打开 App 时清掉，之后的新会话才可以再次拉起。
 */
enum AutoStartSuppression {
    static let markerFileName = "auto-start-suppressed"

    static func dataDirectory(fileManager: FileManager = .default) -> URL {
        let applicationSupport = fileManager
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory())
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        return applicationSupport.appendingPathComponent("Maclawd", isDirectory: true)
    }

    static func suppress() throws {
        try suppress(in: dataDirectory())
    }

    static func suppress(in directory: URL, fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data().write(to: marker(in: directory), options: .atomic)
    }

    static func clear() throws {
        try clear(in: dataDirectory())
    }

    static func clear(in directory: URL, fileManager: FileManager = .default) throws {
        let url = marker(in: directory)
        guard fileManager.fileExists(atPath: url.path) else { return }
        try fileManager.removeItem(at: url)
    }

    private static func marker(in directory: URL) -> URL {
        directory.appendingPathComponent(markerFileName, isDirectory: false)
    }
}
