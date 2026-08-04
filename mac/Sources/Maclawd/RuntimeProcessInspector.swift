import Darwin
import Foundation

enum RuntimeProcessInspector {
    /// 从 macOS KERN_PROCARGS2 读取可执行路径和 argv，用于严格识别无令牌的旧版 runtime。
    static func inspect(pid: Int32) -> RuntimeProcessIdentity? {
        guard pid > 1 else { return nil }
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, u_int(mib.count), nil, &size, nil, 0) == 0, size > 0 else {
            return nil
        }
        var bytes = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, u_int(mib.count), &bytes, &size, nil, 0) == 0,
              size >= MemoryLayout<Int32>.size
        else { return nil }

        let argc = bytes.withUnsafeBytes { $0.load(as: Int32.self) }
        guard argc > 0 else { return nil }
        var cursor = MemoryLayout<Int32>.size

        func readCString() -> String? {
            guard cursor < size else { return nil }
            let start = cursor
            while cursor < size, bytes[cursor] != 0 { cursor += 1 }
            guard cursor > start else { return nil }
            let value = String(decoding: bytes[start..<cursor], as: UTF8.self)
            cursor += 1
            return value
        }

        guard let executable = readCString() else { return nil }
        while cursor < size, bytes[cursor] == 0 { cursor += 1 }

        var arguments: [String] = []
        for _ in 0..<argc {
            guard let argument = readCString() else { break }
            arguments.append(argument)
        }
        guard arguments.count == Int(argc) else { return nil }
        return RuntimeProcessIdentity(pid: pid, executablePath: executable, arguments: arguments)
    }
}
