import Foundation
import Darwin

/// Match Python Kimi CLI's flock protocol. This helper never reads credentials;
/// its parent owns refresh/network/writeback while stdin remains open.
func runCredentialLock(path: String) -> Int32 {
    let fd = open(path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { return 2 }
    defer { close(fd) }
    let deadline = ProcessInfo.processInfo.systemUptime + 5
    while flock(fd, LOCK_EX | LOCK_NB) != 0 {
        guard errno == EWOULDBLOCK, ProcessInfo.processInfo.systemUptime < deadline else { return 3 }
        usleep(50_000)
    }
    defer { flock(fd, LOCK_UN) }
    print("acquired")
    fflush(stdout)
    var input = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN | POLLHUP), revents: 0)
    // EOF releases even if Node exits unexpectedly. Bound a stuck parent's lease.
    _ = poll(&input, 1, 60_000)
    return 0
}
