import AppKit
import SwiftUI

struct PermissionCardItem: Identifiable {
    let id: String
    let agentLabel: String
    let tool: String
    let detail: String
    let project: String
    let expiresAt: Date

    init?(_ json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        agentLabel = json["agentLabel"] as? String ?? "Agent"
        tool = json["tool"] as? String ?? "操作"
        detail = json["detail"] as? String ?? ""
        project = json["project"] as? String ?? ""
        expiresAt = Date(timeIntervalSince1970: ((json["expiresAt"] as? NSNumber)?.doubleValue ?? 0) / 1000)
    }
}

@MainActor
final class PermissionCardStore: ObservableObject {
    @Published var items: [PermissionCardItem] = [] {
        didSet { onItemsChanged?() }
    }
    var port: () -> Int = { 4173 }
    var onItemsChanged: (() -> Void)?
    private var refreshInFlight = false
    private var suppressed = Set<String>()

    func refresh() {
        guard !refreshInFlight else { return }
        guard let url = URL(string: "http://127.0.0.1:\(port())/api/permissions") else { return }
        refreshInFlight = true
        URLSession.shared.dataTask(with: url) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let enabled = json?["enabled"] as? Bool ?? false
            let next = enabled
                ? (json?["pending"] as? [[String: Any]] ?? []).compactMap(PermissionCardItem.init)
                : []
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self.refreshInFlight = false
                    let serverIds = Set(next.map(\.id))
                    self.suppressed.formIntersection(serverIds)
                    self.items = next.filter { !self.suppressed.contains($0.id) }
                }
            }
        }.resume()
    }

    func decide(_ item: PermissionCardItem, _ decision: String) {
        suppressed.insert(item.id)
        items.removeAll { $0.id == item.id }
        guard let url = URL(string: "http://127.0.0.1:\(port())/api/permissions") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["id": item.id, "decision": decision])
        URLSession.shared.dataTask(with: request).resume()
    }
}

@MainActor
final class PermissionCardController {
    private let store = PermissionCardStore()
    private var panel: NSPanel?
    private var timer: Timer?
    var petFrame: () -> NSRect? = { nil }

    init(port: @escaping () -> Int) {
        store.port = port
        store.onItemsChanged = { [weak self] in self?.render() }
    }

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        poll()
    }

    func stop() { timer?.invalidate(); timer = nil; panel?.close(); panel = nil }

    private func poll() {
        store.refresh()
    }

    private func render() {
        guard !store.items.isEmpty else { panel?.orderOut(nil); return }
        let width: CGFloat = 330
        let shown = min(3, store.items.count)
        let height = CGFloat(82 + max(0, shown - 1) * 76 + (store.items.count > 3 ? 24 : 0))
        let view = PermissionCardStack(store: store)
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(x: 0, y: 0, width: width, height: height)
        let window = panel ?? NSPanel(
            contentRect: host.frame, styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.contentView = host
        window.setContentSize(host.frame.size)
        let anchor = petFrame() ?? NSScreen.main?.visibleFrame ?? .zero
        let screen = NSScreen.screens.first(where: { $0.frame.intersects(anchor) }) ?? NSScreen.main
        let area = screen?.visibleFrame ?? .zero
        var x = anchor.minX - width - 10
        if x < area.minX { x = min(area.maxX - width, anchor.maxX + 10) }
        let y = min(max(area.minY, anchor.midY - height / 2), area.maxY - height)
        window.setFrameOrigin(NSPoint(x: x, y: y))
        window.orderFrontRegardless()
        panel = window
    }
}

private struct PermissionCardStack: View {
    @ObservedObject var store: PermissionCardStore
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(store.items.prefix(3).enumerated()), id: \.element.id) { index, item in
                if index > 0 { Divider().opacity(0.45) }
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(item.agentLabel) 请求 \(item.tool)").font(.system(size: 12, weight: .semibold))
                        Text(cardDetail(item))
                            .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 4)
                    Button("拒绝") { store.decide(item, "deny") }.controlSize(.small)
                    Button("允许") { store.decide(item, "allow") }.controlSize(.small)
                        .buttonStyle(.borderedProminent).tint(PanelTheme.accent)
                }
                .padding(12)
            }
            if store.items.count > 3 {
                Text("另有 \(store.items.count - 3) 条等待处理")
                    .font(.system(size: 9.5)).foregroundStyle(.secondary).padding(.bottom, 8)
            }
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.white.opacity(0.16)))
    }

    private func cardDetail(_ item: PermissionCardItem) -> String {
        var parts = [item.project, item.detail].filter { !$0.isEmpty }
        let remaining = max(0, Int(item.expiresAt.timeIntervalSinceNow))
        parts.append("\(remaining) 秒后交回 Agent")
        return parts.joined(separator: " · ")
    }
}
