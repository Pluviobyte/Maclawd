import Foundation

@main
struct PanelTodayAvailabilityContract {
    static func main() {
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
