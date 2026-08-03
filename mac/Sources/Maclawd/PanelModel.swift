import Foundation
import Combine

/**
 面板的数据层。

 **为什么和 RuntimeClient 分开。** RuntimeClient 每 2 秒轮询一次，服务的是
 桌宠和菜单栏——它们一直在屏幕上。面板要的东西多得多（按项目、按模型、
 30 天趋势、区间切换），但面板 90% 的时间是关着的。把这些塞进 2 秒轮询
 等于常年做无人看的重活。

 所以：**只在面板打开时拉，关上就停。**

 解码全部走「缺了就用默认值」，不用严格 Codable 的一次性失败——
 后端多一个字段少一个字段都不该让整块面板变空白。
 */

// MARK: - 额度

struct QuotaWindow: Identifiable, Equatable {
    let id: String
    let label: String
    /// 已重置的窗口没有百分比——重置前那个数字已经不成立了。
    let usedPercent: Double?
    let resetAt: Date?
    /// live / quiet / reset
    let state: String
    let staleSeconds: Int

    var isReset: Bool { state == "reset" }
    var isQuiet: Bool { state == "quiet" }

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String else { return nil }
        self.id = id
        self.label = raw["label"] as? String ?? id
        self.usedPercent = raw["usedPercent"] as? Double
        self.resetAt = (raw["resetAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
        self.state = raw["state"] as? String ?? "live"
        self.staleSeconds = raw["staleSeconds"] as? Int ?? 0
    }
}

struct QuotaContext: Equatable {
    let usedPercent: Double
    let windowSize: Double?

    init?(_ raw: Any?) {
        guard let d = raw as? [String: Any], let used = d["usedPercent"] as? Double else { return nil }
        self.usedPercent = used
        self.windowSize = d["windowSize"] as? Double
    }
}

struct QuotaSource: Identifiable, Equatable {
    let id: String
    let label: String
    let windows: [QuotaWindow]
    let context: QuotaContext?
    let model: String?

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String else { return nil }
        self.id = id
        self.label = raw["label"] as? String ?? id
        self.windows = (raw["windows"] as? [[String: Any]] ?? []).compactMap(QuotaWindow.init)
        self.context = QuotaContext(raw["context"])
        self.model = raw["model"] as? String
    }
}

/// 状态行通道的四种情形。面板据此决定显示什么——「没装通道」和
/// 「装了但还没数据」的文案完全不同，混在一起会让用户干等。
enum StatuslineState: String {
    case none, ours, chained, foreign, unknown
}

struct QuotaSnapshot: Equatable {
    var sources: [QuotaSource] = []
    var empty: Bool = true
    var statusline: StatuslineState = .unknown
    var foreignCommand: String?
    var enabled: Bool = false

    /// 菜单栏第五档用：最紧的那个窗口的已用百分比。
    var tightestUsedPercent: Double? {
        sources.flatMap(\.windows)
            .filter { !$0.isReset }
            .compactMap(\.usedPercent)
            .max()
    }

    /// 解码 `/api/quota`。RuntimeClient 和 PanelStore 共用这一份。
    static func decode(_ json: [String: Any]) -> QuotaSnapshot {
        var out = QuotaSnapshot()
        out.sources = (json["sources"] as? [[String: Any]] ?? []).compactMap(QuotaSource.init)
        out.empty = json["empty"] as? Bool ?? out.sources.isEmpty
        out.enabled = json["enabled"] as? Bool ?? false
        if let sl = json["statusline"] as? [String: Any] {
            out.statusline = StatuslineState(rawValue: sl["state"] as? String ?? "") ?? .unknown
            out.foreignCommand = (sl["foreignCommand"] as? String) ?? (sl["command"] as? String)
        }
        return out
    }
}

struct QuotaAlert: Identifiable, Equatable {
    let key: String
    var id: String { key }
    let sourceLabel: String
    let windowLabel: String
    let usedPercent: Double
    let resetAt: Date?

    init?(_ raw: [String: Any]) {
        guard let key = raw["key"] as? String,
              let used = raw["usedPercent"] as? Double else { return nil }
        self.key = key
        self.sourceLabel = raw["sourceLabel"] as? String ?? ""
        self.windowLabel = raw["windowLabel"] as? String ?? ""
        self.usedPercent = used
        self.resetAt = (raw["resetAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
    }
}

// MARK: - 用量

struct NamedBucket: Identifiable, Equatable {
    let id: String
    let billable: Double
    let throughput: Double
}

struct DailyPoint: Identifiable, Equatable {
    var id: String { day }
    let day: String
    let billable: Double
    let throughput: Double
}

struct PanelSummary: Equatable {
    var empty = true
    var billable: Double = 0
    var throughput: Double = 0
    var cost: Double?
    var hitRate: Double = 0
    var activeSeconds: Int = 0
    var sessions: Int = 0
    var baseline: Double?
    var hours: [Double] = []
    var hoursAvailable = false
    var daily: [DailyPoint] = []
    var byProject: [NamedBucket] = []
    var byModel: [NamedBucket] = []
    var bySource: [NamedBucket] = []
    var coverage: Double = 1
    var unpricedModels: [String] = []
    var primaryMetric: String = "billable"
    var showCost = false

    var primary: Double { primaryMetric == "throughput" ? throughput : billable }

    /// 与个人 14 天中位数比。**不用「比昨天」**——昨天可能正好休息，
    /// 波动没有信息量。
    var comparedToUsual: Double? {
        guard let baseline, baseline > 0, throughput > 0 else { return nil }
        return (throughput - baseline) / baseline
    }
}

// MARK: - Store

@MainActor
final class PanelStore: ObservableObject {
    @Published private(set) var summary = PanelSummary()
    @Published private(set) var quota = QuotaSnapshot()
    @Published private(set) var settings: [String: Any] = [:]
    @Published private(set) var loading = false
    @Published private(set) var lastError: String?
    @Published var range: String = "today" { didSet { if range != oldValue { refresh() } } }

    private let session: URLSession
    private var port: Int
    private var timer: Timer?
    private var inFlight = 0

    init(port: Int) {
        self.port = port
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        self.session = URLSession(configuration: config)
    }

    func updatePort(_ next: Int) { port = next }

    /// 面板打开：立刻拉一次，然后 5 秒一轮。
    /// 5 秒而不是 2 秒——面板上的数字都是聚合量，跳得太快反而像在闪。
    func start() {
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    /// 面板关闭：停掉轮询。这是这个类存在的主要理由。
    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func get(_ path: String, _ handler: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else {
            handler(nil); return
        }
        inFlight += 1
        loading = true
        session.dataTask(with: url) { [weak self] data, _, error in
            let json = data.flatMap {
                try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
            } ?? nil
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.inFlight -= 1
                    if self.inFlight <= 0 { self.loading = false }
                    if json == nil, let error { self.lastError = error.localizedDescription }
                    else if json != nil { self.lastError = nil }
                    handler(json)
                }
            }
        }.resume()
    }

    func refresh() {
        var query = "range=\(range)"
        if range.isEmpty { query = "range=today" }
        get("/api/summary?\(query)") { [weak self] json in
            guard let self, let json else { return }
            self.summary = Self.decodeSummary(json)
        }
        get("/api/quota") { [weak self] json in
            guard let self, let json else { return }
            self.quota = QuotaSnapshot.decode(json)
        }
    }

    // MARK: 解码

    private static func bucketTotals(_ raw: Any?) -> [NamedBucket] {
        guard let map = raw as? [String: [String: Any]] else { return [] }
        return map.map { key, bucket in
            let d = { (k: String) in bucket[k] as? Double ?? 0 }
            // 与 web/usage.html 的 bill()/tput() 同一套口径：
            // 计费不含缓存读，吞吐含。
            let bill = d("input") + d("write5m") + d("write1h") + d("output")
            return NamedBucket(id: key, billable: bill, throughput: bill + d("cacheRead"))
        }
        .sorted { $0.billable > $1.billable }
    }

    static func decodeSummary(_ json: [String: Any]) -> PanelSummary {
        var out = PanelSummary()
        out.empty = json["empty"] as? Bool ?? false
        let settings = json["settings"] as? [String: Any] ?? [:]
        out.primaryMetric = settings["primaryMetric"] as? String ?? "billable"
        out.showCost = settings["showCost"] as? Bool ?? false
        out.coverage = json["coverage"] as? Double ?? 1
        out.baseline = json["baseline"] as? Double

        if let s = json["summary"] as? [String: Any] {
            out.billable = s["billable"] as? Double ?? 0
            out.throughput = s["throughput"] as? Double ?? 0
            out.cost = s["cost"] as? Double
            out.hitRate = s["hitRate"] as? Double ?? 0
            out.hours = s["hours"] as? [Double] ?? []
            out.hoursAvailable = s["hoursAvailable"] as? Bool ?? false
            out.unpricedModels = s["unpricedModels"] as? [String] ?? []
            out.daily = (s["daily"] as? [[String: Any]] ?? []).compactMap { d in
                guard let day = d["day"] as? String else { return nil }
                return DailyPoint(day: day,
                                  billable: d["billable"] as? Double ?? 0,
                                  throughput: d["throughput"] as? Double ?? 0)
            }
            out.byProject = bucketTotals(s["byProject"])
            out.byModel = bucketTotals(s["byModel"])
            out.bySource = bucketTotals(s["bySource"])
        }
        if let sessions = json["sessions"] as? [String: Any] {
            out.activeSeconds = sessions["activeSeconds"] as? Int ?? 0
            out.sessions = sessions["sessions"] as? Int ?? 0
        }
        return out
    }

    // MARK: 写

    private func post(_ path: String, body: [String: Any], done: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else { done(nil); return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        session.dataTask(with: request) { data, _, _ in
            let json = data.flatMap {
                try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
            } ?? nil
            DispatchQueue.main.async { MainActor.assumeIsolated { done(json) } }
        }.resume()
    }

    func setSetting(_ key: String, _ value: Any, done: @escaping ([String: Any]?) -> Void = { _ in }) {
        post("/api/settings", body: [key: value]) { [weak self] json in
            if let s = json?["settings"] as? [String: Any] { self?.settings = s }
            self?.refresh()
            done(json)
        }
    }

    func loadSettings() {
        get("/api/settings") { [weak self] json in
            if let s = json?["settings"] as? [String: Any] { self?.settings = s }
        }
    }

    func statuslineAction(_ action: String, done: @escaping ([String: Any]?) -> Void) {
        post("/api/statusline", body: ["action": action]) { [weak self] json in
            self?.refresh()
            self?.loadSettings()
            done(json)
        }
    }

    func resetData(done: @escaping () -> Void) {
        post("/api/reset", body: [:]) { [weak self] _ in self?.refresh(); done() }
    }

    func rescan(done: @escaping () -> Void) {
        post("/api/scan", body: [:]) { [weak self] _ in self?.refresh(); done() }
    }

    func updatePrices(done: @escaping ([String: Any]?) -> Void) {
        post("/api/update-prices", body: [:]) { [weak self] json in self?.refresh(); done(json) }
    }

    func bool(_ key: String, default fallback: Bool = false) -> Bool {
        settings[key] as? Bool ?? fallback
    }

    func number(_ key: String, default fallback: Double) -> Double {
        settings[key] as? Double ?? fallback
    }
}

// MARK: - 格式化

enum Fmt {
    static func tokens(_ n: Double) -> String {
        if n >= 1e9 { return String(format: "%.2fB", n / 1e9) }
        if n >= 1e6 { return String(format: "%.2fM", n / 1e6) }
        if n >= 1e3 { return String(format: "%.1fK", n / 1e3) }
        return String(Int(n.rounded()))
    }

    static func percent(_ x: Double) -> String {
        String(format: x >= 0.995 || x == 0 ? "%.0f%%" : "%.1f%%", x * 100)
    }

    static func duration(_ seconds: Int) -> String {
        let h = seconds / 3600, m = (seconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    /// 距离重置还有多久。越远精度越粗——「6 天后」比「151h14m」好读。
    static func until(_ date: Date?, now: Date = Date()) -> String? {
        guard let date else { return nil }
        let secs = Int(date.timeIntervalSince(now))
        if secs <= 0 { return "即将重置" }
        let h = secs / 3600, m = (secs % 3600) / 60
        if h >= 24 { return "\(h / 24) 天 \(h % 24) 小时后重置" }
        if h > 0 { return "\(h)h\(String(format: "%02d", m))m 后重置" }
        return "\(m) 分钟后重置"
    }
}
