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
                           "estimatedCost": 3.5, "activeSeconds": 120.0]],
            "sessions": ["available": true, "totals": [
                "sessions": 2, "activeSeconds": 120, "durationSeconds": 600,
                "messageCount": 20, "userMessageCount": 4,
            ]],
            "distributions": [
                "tools": [["id": "codex", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
                "models": [["id": "gpt-test", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
                "projects": [["id": "Maclawd", "totalTokens": 1_000.0, "estimatedCost": 3.5]],
            ],
            "dimensions": ["sources": ["codex"], "models": ["gpt-test"], "projects": ["Maclawd"]],
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
        precondition(snapshot.distributions.models.first?.id == "gpt-test")
        precondition(snapshot.dimensions.projects == ["Maclawd"])
        precondition(snapshot.collection.complete == false)
        precondition(snapshot.collection.sources["codex"]?.deferredFiles == 3)
        precondition(snapshot.collection.progress == 0.7)
        precondition(snapshot.records.items.first?.source == "codex")
        precondition(snapshot.records.nextCursor == "cursor-1")
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
    }
}
