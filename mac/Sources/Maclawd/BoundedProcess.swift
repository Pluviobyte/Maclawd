import Foundation
import Darwin

/// Small discovery probes must not block forever on shell profiles or a full
/// stdout pipe. Vibe Usage App bc381825 uses the same file-backed output design.
enum BoundedProcess {
    static func output(executable: URL, arguments: [String], timeout: TimeInterval = 3,
                       limit: Int = 65_536) -> String? {
        let fm = FileManager.default
        let directory = fm.temporaryDirectory.appendingPathComponent("maclawd-probe-\(UUID().uuidString)")
        let file = directory.appendingPathComponent("stdout")
        let process = Process()
        let exited = DispatchSemaphore(value: 0)
        var handle: FileHandle?
        defer {
            try? handle?.close()
            try? fm.removeItem(at: directory)
        }
        do {
            try fm.createDirectory(at: directory, withIntermediateDirectories: false,
                                   attributes: [.posixPermissions: 0o700])
            guard fm.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { return nil }
            handle = try FileHandle(forWritingTo: file)
            process.executableURL = executable
            process.arguments = arguments
            process.standardOutput = handle
            process.standardError = FileHandle.nullDevice
            process.standardInput = FileHandle.nullDevice
            process.terminationHandler = { _ in exited.signal() }
            try process.run()
            let deadline = ProcessInfo.processInfo.systemUptime + timeout
            while process.isRunning {
                let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
                if ProcessInfo.processInfo.systemUptime >= deadline || size > limit {
                    // No waitUntilExit: even an uncooperative child has a bounded wait.
                    kill(process.processIdentifier, SIGKILL)
                    _ = exited.wait(timeout: .now() + 1)
                    return nil
                }
                Thread.sleep(forTimeInterval: 0.01)
            }
            guard process.terminationStatus == 0 else { return nil }
            let input = try FileHandle(forReadingFrom: file)
            defer { try? input.close() }
            let data = try input.read(upToCount: limit + 1) ?? Data()
            guard data.count <= limit else { return nil }
            return String(data: data, encoding: .utf8)
        } catch { return nil }
    }
}
