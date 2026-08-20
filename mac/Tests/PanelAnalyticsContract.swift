import Foundation

@main
struct PanelAnalyticsContract {
    static func main() {
        let json: [String: Any] = [
            "range": "30d",
            "totals": [
                "inputTokens": 120.0, "outputTokens": 30.0, "reasoningTokens": 10.0,
                "cachedTokens": 840.0, "totalTokens": 1_000.0,
                "nonCachedReadTokens": 160.0, "billableTokens": 160.0,
            ],
            "previous": ["totalTokens": 500.0],
            "comparison": ["totalTokens": 1.0, "estimatedCost": 0.25],
            "cost": ["estimated": 3.5, "coverage": 0.98, "unpricedModels": ["new-model"]],
            "series": [["day": "2026-08-03", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
            "heatmap": [["weekday": 1, "hour": 10, "totalTokens": 1_000.0,
                           "estimatedCost": 3.5, "activeSeconds": 120.0,
                           "dateStart": "2026-07-27", "dateEnd": "2026-08-17",
                           "dateCount": 4]],
            "sessions": ["available": true, "totals": [
                "sessions": 2, "activeSeconds": 120, "durationSeconds": 600,
                "messageCount": 20, "userMessageCount": 4,
            ]],
            "distributions": [
                "tools": [["id": "codex", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
                "models": [["id": "gpt-test", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
                "projects": [["id": "Maclawd", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
            ],
            "dimensions": [
                "sources": ["codex"], "models": ["gpt-test"], "projects": ["Maclawd"],
                "sourceLabels": ["codex": "Codex"],
            ],
            "collection": ["complete": false, "deferredFiles": 3, "sources": [
                "codex": ["discoveredFiles": 10, "indexedFiles": 7, "deferredFiles": 3,
                          "failedFiles": 0, "complete": false, "latestRecordAt": 1234.0],
            ]],
            "records": ["items": [[
                "slotStart": 1_785_737_400_000.0, "source": "codex", "model": "gpt-test",
                "project": "Maclawd", "inputTokens": 120.0, "outputTokens": 30.0,
                "reasoningTokens": 10.0, "cachedTokens": 840.0,
                "totalTokens": 1_000.0, "estimatedCost": 3.5,
            ]], "total": 2, "nextCursor": "cursor-1"],
        ]

        let snapshot = AnalyticsSnapshot.decode(json)
        precondition(snapshot.range == "30d")
        precondition(snapshot.totals.totalTokens == 1_000)
        precondition(snapshot.totals.nonCachedReadTokens == 160)
        precondition(snapshot.cost.coverage == 0.98)
        precondition(snapshot.sessions.totals.messageCount == 20)
        precondition(snapshot.series.first?.day == "2026-08-03")
        precondition(snapshot.heatmap.first?.hour == 10)
        precondition(snapshot.heatmap.first?.dateStart == "2026-07-27")
        precondition(snapshot.heatmap.first?.dateEnd == "2026-08-17")
        precondition(snapshot.heatmap.first?.dateCount == 4)
        precondition(snapshot.distributions.models.first?.id == "gpt-test")
        precondition(snapshot.dimensions.projects == ["Maclawd"])
        precondition(snapshot.collection.complete == false)
        precondition(snapshot.collection.sources["codex"]?.deferredFiles == 3)
        precondition(snapshot.collection.progress == 0.7)
        precondition(snapshot.collection.sources["codex"]?.progress == 0.7)
        precondition(snapshot.records.items.first?.source == "codex")
        precondition(snapshot.records.nextCursor == "cursor-1")

        // 统计页区间条与菜单统一显示简洁的产品名。
        precondition(snapshot.dimensions.label(forSource: "codex") == "Codex")
        precondition(snapshot.dimensions.shortLabel(forSource: "codex") == "Codex")
        // 服务端没给标签时必须回落到 id，不能显示空白。
        precondition(snapshot.dimensions.label(forSource: "grok") == "grok")
        precondition(snapshot.dimensions.shortLabel(forSource: "grok") == "grok")

        let names = AnalyticsDimensions([
            "sources": ["claude-code", "grok", "workbuddy", "opencode", "pi"],
            "sourceLabels": [
                "claude-code": "Claude Code", "grok": "Grok Build",
                "workbuddy": "WorkBuddy", "opencode": "OpenCode", "pi": "pi",
            ],
        ])
        precondition(names.shortLabel(forSource: "claude-code") == "Claude")
        precondition(names.shortLabel(forSource: "grok") == "Grok")
        // 没有空格的尾缀不是尾缀，不能砍成 "Open" / "Work"。
        precondition(names.shortLabel(forSource: "opencode") == "OpenCode")
        precondition(names.shortLabel(forSource: "workbuddy") == "WorkBuddy")
        // 砍完会变空的，宁可原样显示。
        precondition(names.shortLabel(forSource: "pi") == "pi")

        let sourceProgress = AnalyticsSourceStatus([
            "discoveredFiles": 10, "deferredFiles": 0, "complete": false,
        ])
        precondition(sourceProgress.progress == nil, "分母不完整时不显示假的 100%")
        let unknownProgress = AnalyticsCollection([
            "complete": false,
            "sources": ["codex": [
                "discoveredFiles": 10, "deferredFiles": 0, "complete": false,
            ]],
        ])
        precondition(unknownProgress.progress == nil)
        let unpriced = AnalyticsSnapshot.decode([
            "cost": ["estimated": NSNull(), "coverage": 0.0],
        ])
        precondition(unpriced.cost.estimated == nil)

        let quota = QuotaSnapshot.decode([
            "sources": [],
            "empty": true,
        ], workBuddyInstalled: true)
        precondition(quota.workBuddy.installed)

        let workBuddy = QuotaSource([
            "id": "workbuddy",
            "label": "WorkBuddy",
            "windows": [
                [
                    "id": "base-1", "label": "个人体验版", "kind": "base",
                    "used": 100.0, "limit": 500.0, "remaining": 400.0,
                    "usedPercent": 20.0, "resetAt": 3_000.0, "state": "live",
                ],
                [
                    "id": "bonus-late", "label": "裂变包", "kind": "bonus",
                    "used": 100.0, "limit": 1_500.0, "remaining": 1_400.0,
                    "usedPercent": 6.666, "resetAt": 5_000.0, "state": "live",
                ],
                [
                    "id": "bonus-first", "label": "裂变包", "kind": "bonus",
                    "used": 0.0, "limit": 100.0, "remaining": 100.0,
                    "usedPercent": 0.0, "resetAt": 4_000.0, "state": "live",
                ],
                [
                    "id": "bonus-reset", "label": "旧包", "kind": "bonus",
                    "usedPercent": NSNull(), "state": "reset",
                ],
            ],
        ])!
        let presentation = WorkBuddyQuotaPresentation(source: workBuddy)
        precondition(presentation.base?.label == "订阅额度")
        precondition(presentation.base?.limit == 500)
        precondition(presentation.base?.remaining == 400)
        precondition(presentation.bonus?.label == "额外额度")
        precondition(presentation.bonus?.used == 100)
        precondition(presentation.bonus?.limit == 1_600)
        precondition(presentation.bonus?.remaining == 1_500)
        precondition(presentation.bonus?.resetAt == Date(timeIntervalSince1970: 4))
        precondition(presentation.bonusDetails.map(\.id) == ["bonus-first", "bonus-late"])
        precondition(presentation.bonusDetails.map(\.label) == ["裂变包", "裂变包"])

        let incomplete = QuotaSource([
            "id": "workbuddy", "label": "WorkBuddy",
            "windows": [[
                "id": "partial", "label": "活动加量包", "kind": "bonus",
                "usedPercent": 50.0, "state": "live",
            ]],
        ])!
        let incompletePresentation = WorkBuddyQuotaPresentation(source: incomplete)
        precondition(incompletePresentation.bonus == nil)
        precondition(incompletePresentation.bonusDetails.map(\.label) == ["活动加量包"])

        precondition(WorkBuddyInstallationDetector.isInstalled { identifier in
            identifier == "com.workbuddy.workbuddy" ? URL(fileURLWithPath: "/Moved/WorkBuddy.app") : nil
        })
        precondition(!WorkBuddyInstallationDetector.isInstalled { _ in nil })
    }
}
