import AppKit
import Darwin

/**
 把「哪个 agent 发起的这个状态」变成「跳到哪个窗口」。

 桌宠亮着 needs_owner（Curtain Peek）的时候，它其实知道是谁在等你回答——
 hook 把发起进程的 pid 一路送到了这里。缺的只是最后一步：**点它，带你过去**。
 没有这一步，那个动作只是个提醒；有了这一步，它是个入口。

 **为什么不用 osascript。** `tell application "System Events" to set frontmost
 of process whose unix id is N` 能做同样的事，但它要走 Automation 授权——
 第一次触发会弹一个系统对话框，而且被拒之后再也不提示。
 NSRunningApplication.activate() 不需要任何授权，装上就能用。

 **为什么要沿父进程链往上走。** hook 送来的是 agent 自己的 pid（一个 node
 进程），它不是应用进程，NSWorkspace 里根本没有它。真正能激活的是它的某个
 祖先——Terminal / iTerm / Ghostty / VS Code 的宿主进程。所以从 pid 出发
 逐级取父进程，第一个能在运行中的应用里对上号的就是目标。
 */
enum TerminalFocus {

    /// 一个进程的父进程。走 sysctl 而不是 spawn 一个 ps——
    /// 这条路径可能在点击时同步执行，不该有进程创建的开销。
    static func parent(of pid: pid_t) -> pid_t? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        let ok = mib.withUnsafeMutableBufferPointer { buffer -> Bool in
            sysctl(buffer.baseAddress, u_int(buffer.count), &info, &size, nil, 0) == 0
        }
        // size == 0 表示进程已经不在了（返回 0 但没填任何东西）
        guard ok, size > 0 else { return nil }
        let ppid = info.kp_eproc.e_ppid
        // 0 是内核，1 是 launchd——再往上走没有意义
        return ppid > 1 ? ppid : nil
    }

    /// 从 pid 出发，沿父进程链找第一个正在运行的应用。
    ///
    /// 深度设上限：进程链理论上不会成环（父进程 pid 总是更小），
    /// 但一个被回收后复用的 pid 可以让这个假设不成立，不设限就是死循环。
    static func owningApplication(of pid: pid_t, maxDepth: Int = 12) -> NSRunningApplication? {
        let running = NSWorkspace.shared.runningApplications
        var current: pid_t? = pid
        var depth = 0
        while let candidate = current, depth < maxDepth {
            if let app = running.first(where: { $0.processIdentifier == candidate }) {
                return app
            }
            current = parent(of: candidate)
            depth += 1
        }
        return nil
    }

    /// 激活发起这个状态的终端窗口。
    /// - Returns: 找到并激活了返回 true；进程已经退出、或压根没有可激活的宿主返回 false。
    @discardableResult
    static func activate(pid: pid_t) -> Bool {
        guard pid > 1, let app = owningApplication(of: pid) else { return false }
        // .activateAllWindows 是刻意的：终端常常开着好几个窗口，
        // 只抬一个上来的话，你要找的那个可能还压在别人下面。
        return app.activate(options: [.activateAllWindows])
    }
}
