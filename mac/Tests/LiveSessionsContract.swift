import Foundation

func liveSession(_ values: [String: Any]) -> LiveAgentSession {
    guard let session = LiveAgentSession(values) else { fatalError("会话解码失败") }
    return session
}

@main
struct LiveSessionsContract {
    static func main() {
        let sessions = [
            liveSession([
                "id": "codex-a", "agentLabel": "Codex", "state": "thinking",
                "stateLabel": "思考中", "statePriority": 2,
                "project": "Maclawd", "projectPath": "/Users/rain/Desktop/Maclawd",
                "stateSince": 2_000, "at": 5_000, "subagents": 0,
            ]),
            liveSession([
                "id": "claude-a", "agentLabel": "Claude Code", "state": "needs_owner",
                "stateLabel": "等待你批准", "statePriority": 0,
                "project": "Maclawd", "projectPath": "/Users/rain/Desktop/Maclawd",
                "stateSince": 3_000, "at": 4_000, "subagents": 2,
            ]),
            liveSession([
                "id": "codex-b", "agentLabel": "Codex", "state": "working",
                "stateLabel": "工作中", "statePriority": 1,
                "project": "Other", "projectPath": "/tmp/Other",
                "stateSince": 1_000, "at": 6_000, "subagents": 0,
            ]),
        ]

        let groups = LiveProjectGroup.make(from: sessions)
        precondition(groups.count == 2)
        precondition(groups[0].name == "Maclawd")
        precondition(groups[0].path == "/Users/rain/Desktop/Maclawd")
        precondition(groups[0].sessions.map(\.id) == ["claude-a", "codex-a"])
        precondition(groups[1].name == "Other")

        let unknown = LiveProjectGroup.make(from: [
            liveSession(["id": "unknown", "agentLabel": "其他 Agent", "state": "idle"]),
        ])
        precondition(unknown.count == 1)
        precondition(unknown[0].name == "未识别项目")
        precondition(unknown[0].path.isEmpty)
    }
}
