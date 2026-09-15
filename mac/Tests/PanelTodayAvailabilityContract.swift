import Foundation

@main
struct PanelTodayAvailabilityContract {
    static func main() {
        for timestamp in ["2026-09-15T12:00:00.000Z", "2026-09-15T12:00:00Z"] {
            let summary = PanelStore.decodeSummary(["empty": true, "pricing": ["fetchedAt": timestamp]])
            precondition(summary.pricingUpdatedAt != nil)
        }
        precondition(PanelStore.decodeSummary(["pricing": ["fetchedAt": "invalid"]]).pricingUpdatedAt == nil)
        precondition(PanelStore.decodeSummary([:]).pricingUpdatedAt == nil)
        let stillIndexing = PanelStore.decodeSummary([
            "empty": false,
            "summary": ["throughput": 0.0],
            "collection": ["complete": false, "deferredFiles": 12],
        ])
        precondition(stillIndexing.primaryAvailable == false)
        precondition(stillIndexing.nextCollectionScanLabel == "正在自动继续处理")

        let partialValue = PanelStore.decodeSummary([
            "empty": false,
            "summary": ["throughput": 42.0],
            "collection": ["complete": false, "deferredFiles": 12],
        ])
        precondition(partialValue.primaryAvailable == true)

        let exactZero = PanelStore.decodeSummary([
            "empty": false,
            "summary": ["throughput": 0.0],
            "collection": ["complete": true, "deferredFiles": 0],
        ])
        precondition(exactZero.primaryAvailable == true)
    }
}
