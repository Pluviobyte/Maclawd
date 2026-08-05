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
    /// WorkBuddy Credits 的精确数值；Claude/Codex 没有这些字段时保持 nil。
    let used: Double?
    let limit: Double?
    let remaining: Double?
    let kind: String?

    var isReset: Bool { state == "reset" }
    var isQuiet: Bool { state == "quiet" }
    var remainingPercent: Double? {
        usedPercent.map { max(0, min(100, 100 - $0)) }
    }

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String else { return nil }
        self.id = id
        self.label = raw["label"] as? String ?? id
        self.usedPercent = raw["usedPercent"] as? Double
        self.resetAt = (raw["resetAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
        self.state = raw["state"] as? String ?? "live"
        self.staleSeconds = raw["staleSeconds"] as? Int ?? 0
        self.used = raw["used"] as? Double
        self.limit = raw["limit"] as? Double
        self.remaining = raw["remaining"] as? Double
        self.kind = raw["kind"] as? String
    }
}

struct QuotaContext: Equatable {
    let usedPercent: Double
    let windowSize: Double?

    var remainingPercent: Double { max(0, min(100, 100 - usedPercent)) }

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

struct WorkBuddyQuotaStatus: Equatable {
    var installed = false
    var refreshing = false
    var lastErrorCode: String?
    var lastSuccessAt: Date?

    mutating func decode(_ raw: Any?) {
        guard let value = raw as? [String: Any] else { return }
        refreshing = value["refreshing"] as? Bool ?? false
        if let error = value["lastError"] as? [String: Any] {
            lastErrorCode = error["code"] as? String
        } else {
            lastErrorCode = nil
        }
        lastSuccessAt = (value["lastSuccessAt"] as? Double).map {
            Date(timeIntervalSince1970: $0 / 1000)
        }
    }
}

/// 状态行通道的四种情形。面板据此决定显示什么——「没装通道」和
/// 「装了但还没数据」的文案完全不同，混在一起会让用户干等。
enum StatuslineState: String {
    case none, ours, chained, foreign, unknown
}

struct QuotaSnapshot: Equatable {
    var sources: [QuotaSource] = []
    var workBuddy = WorkBuddyQuotaStatus()
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
    static func decode(
        _ json: [String: Any],
        workBuddyInstalled: Bool = false
    ) -> QuotaSnapshot {
        var out = QuotaSnapshot()
        out.sources = (json["sources"] as? [[String: Any]] ?? []).compactMap(QuotaSource.init)
        out.workBuddy.installed = workBuddyInstalled
        out.workBuddy.decode(json["workBuddy"])
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
    var primaryMetric: String = "throughput"
    var showCost = false
    var collectionComplete = false
    var deferredFiles = 0
    var collectionTotalFiles = 0
    var collectionProcessedFiles = 0
    var collectionScannedAt: Date?

    var primary: Double { throughput }
    /// 索引未完成且还没找到今天的记录时，0 只是默认值，不是可展示的测量值。
    var primaryAvailable: Bool { collectionComplete || primary > 0 }

    var collectionProgress: Double? {
        guard collectionTotalFiles > 0 else { return nil }
        return min(1, max(0, Double(collectionProcessedFiles) / Double(collectionTotalFiles)))
    }

    var nextCollectionScanLabel: String {
        if !collectionComplete { return "正在自动继续处理" }
        guard let collectionScannedAt else { return "稍后会自动继续处理" }
        let seconds = collectionScannedAt.addingTimeInterval(30 * 60).timeIntervalSinceNow
        if seconds <= 30 { return "即将自动继续处理" }
        let minutes = max(1, Int(ceil(seconds / 60)))
        return "约 \(minutes) 分钟后自动继续"
    }

    /// 与个人 14 天中位数比。**不用「比昨天」**——昨天可能正好休息，
    /// 波动没有信息量。
    var comparedToUsual: Double? {
        guard collectionComplete, let baseline, baseline > 0, throughput > 0 else { return nil }
        return (throughput - baseline) / baseline
    }
}

// MARK: - Usage Analytics

/// JSONSerialization represents every JSON number as NSNumber. Centralising the
/// conversion keeps the analytics decoder tolerant of integer/decimal changes in
/// the runtime response.
private func jsonDouble(_ value: Any?) -> Double {
    (value as? NSNumber)?.doubleValue ?? 0
}

private func jsonOptionalDouble(_ value: Any?) -> Double? {
    (value as? NSNumber)?.doubleValue
}

private func jsonInt(_ value: Any?) -> Int {
    (value as? NSNumber)?.intValue ?? 0
}

struct AnalyticsTotals: Equatable {
    var inputTokens = 0.0
    var outputTokens = 0.0
    var reasoningTokens = 0.0
    var cachedTokens = 0.0
    var totalTokens = 0.0
    var nonCachedReadTokens = 0.0

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        inputTokens = jsonDouble(d["inputTokens"])
        outputTokens = jsonDouble(d["outputTokens"])
        reasoningTokens = jsonDouble(d["reasoningTokens"])
        cachedTokens = jsonDouble(d["cachedTokens"])
        totalTokens = jsonDouble(d["totalTokens"])
        nonCachedReadTokens = d["nonCachedReadTokens"] == nil
            ? jsonDouble(d["billableTokens"])
            : jsonDouble(d["nonCachedReadTokens"])
    }
}

struct AnalyticsCost: Equatable {
    var estimated: Double?
    var coverage = 1.0
    var pricedTokens = 0.0
    var unpricedTokens = 0.0
    var unpricedModels: [String] = []

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        estimated = jsonOptionalDouble(d["estimated"])
        coverage = d["coverage"] == nil ? 1 : jsonDouble(d["coverage"])
        pricedTokens = jsonDouble(d["pricedTokens"])
        unpricedTokens = jsonDouble(d["unpricedTokens"])
        unpricedModels = d["unpricedModels"] as? [String] ?? []
    }
}

struct AnalyticsSessionTotals: Equatable {
    var sessions = 0
    var activeSeconds = 0
    var durationSeconds = 0
    var messageCount = 0
    var userMessageCount = 0

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        sessions = jsonInt(d["sessions"])
        activeSeconds = jsonInt(d["activeSeconds"])
        durationSeconds = jsonInt(d["durationSeconds"])
        messageCount = jsonInt(d["messageCount"])
        userMessageCount = jsonInt(d["userMessageCount"])
    }
}

struct AnalyticsSessions: Equatable {
    var available = true
    var reason: String?
    var totals = AnalyticsSessionTotals()

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        available = d["available"] as? Bool ?? true
        reason = d["reason"] as? String
        totals = AnalyticsSessionTotals(d["totals"])
    }
}

struct AnalyticsSeriesPoint: Identifiable, Equatable {
    var id: String { day }
    let day: String
    let inputTokens: Double
    let outputTokens: Double
    let reasoningTokens: Double
    let cachedTokens: Double
    let totalTokens: Double
    let estimatedCost: Double?
    let activeSeconds: Int
    let durationSeconds: Int

    init?(_ raw: [String: Any]) {
        guard let day = raw["day"] as? String else { return nil }
        self.day = day
        inputTokens = jsonDouble(raw["inputTokens"])
        outputTokens = jsonDouble(raw["outputTokens"])
        reasoningTokens = jsonDouble(raw["reasoningTokens"])
        cachedTokens = jsonDouble(raw["cachedTokens"])
        totalTokens = jsonDouble(raw["totalTokens"])
        estimatedCost = jsonOptionalDouble(raw["estimatedCost"])
        activeSeconds = jsonInt(raw["activeSeconds"])
        durationSeconds = jsonInt(raw["durationSeconds"])
    }
}

struct AnalyticsHeatCell: Identifiable, Equatable {
    var id: String { "\(weekday)-\(hour)" }
    let weekday: Int
    let hour: Int
    let totalTokens: Double
    let estimatedCost: Double?
    let activeSeconds: Int

    init?(_ raw: [String: Any]) {
        guard raw["weekday"] != nil, raw["hour"] != nil else { return nil }
        weekday = jsonInt(raw["weekday"])
        hour = jsonInt(raw["hour"])
        totalTokens = jsonDouble(raw["totalTokens"])
        estimatedCost = jsonOptionalDouble(raw["estimatedCost"])
        activeSeconds = jsonInt(raw["activeSeconds"])
    }
}

struct AnalyticsDistributionItem: Identifiable, Equatable {
    let id: String
    let totalTokens: Double
    let nonCachedReadTokens: Double
    let estimatedCost: Double?

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String else { return nil }
        self.id = id
        totalTokens = jsonDouble(raw["totalTokens"])
        nonCachedReadTokens = raw["nonCachedReadTokens"] == nil
            ? jsonDouble(raw["billableTokens"])
            : jsonDouble(raw["nonCachedReadTokens"])
        estimatedCost = jsonOptionalDouble(raw["estimatedCost"])
    }
}

struct AnalyticsDistributions: Equatable {
    var tools: [AnalyticsDistributionItem] = []
    var models: [AnalyticsDistributionItem] = []
    var projects: [AnalyticsDistributionItem] = []

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        tools = (d["tools"] as? [[String: Any]] ?? []).compactMap(AnalyticsDistributionItem.init)
        models = (d["models"] as? [[String: Any]] ?? []).compactMap(AnalyticsDistributionItem.init)
        projects = (d["projects"] as? [[String: Any]] ?? []).compactMap(AnalyticsDistributionItem.init)
    }
}

struct AnalyticsDimensions: Equatable {
    var sources: [String] = []
    var models: [String] = []
    var projects: [String] = []

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        sources = d["sources"] as? [String] ?? []
        models = d["models"] as? [String] ?? []
        projects = d["projects"] as? [String] ?? []
    }
}

struct AnalyticsSourceStatus: Equatable {
    var discoveredFiles = 0
    var indexedFiles = 0
    var deferredFiles = 0
    var failedFiles = 0
    var complete = false
    var latestRecordAt: Double?

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        discoveredFiles = jsonInt(d["discoveredFiles"])
        indexedFiles = jsonInt(d["indexedFiles"])
        deferredFiles = jsonInt(d["deferredFiles"])
        failedFiles = jsonInt(d["failedFiles"])
        complete = d["complete"] as? Bool ?? false
        latestRecordAt = jsonOptionalDouble(d["latestRecordAt"])
    }
}

struct AnalyticsCollection: Equatable {
    var complete = false
    var scannedAt: String?
    var deferredFiles = 0
    var sources: [String: AnalyticsSourceStatus] = [:]

    /// 文件级索引进度。它描述“多少日志文件已经进入统计”，不是对 Token
    /// 总量的猜测，因此可以作为准确百分比展示。
    var progress: Double? {
        let total = sources.values.reduce(0) { $0 + $1.discoveredFiles }
        guard total > 0 else { return nil }
        let deferred = sources.values.reduce(0) { $0 + $1.deferredFiles }
        let value = min(1, max(0, Double(total - deferred) / Double(total)))
        // “未完成但没有待处理文件”通常表示来源发现失败，分母本身不完整。
        // 这种情况下没有可信百分比，宁可显示“处理中”也不显示假的 100%。
        if !complete && value >= 1 { return nil }
        return value
    }

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        complete = d["complete"] as? Bool ?? false
        scannedAt = d["scannedAt"] as? String
        deferredFiles = jsonInt(d["deferredFiles"])
        for (key, value) in d["sources"] as? [String: Any] ?? [:] {
            sources[key] = AnalyticsSourceStatus(value)
        }
    }
}

struct AnalyticsRecord: Identifiable, Equatable {
    var id: String { "\(Int(slotStart))-\(source)-\(model)-\(project)" }
    let slotStart: Double
    let source: String
    let model: String
    let project: String
    let inputTokens: Double
    let outputTokens: Double
    let reasoningTokens: Double
    let cachedTokens: Double
    let totalTokens: Double
    let estimatedCost: Double?

    init?(_ raw: [String: Any]) {
        guard let source = raw["source"] as? String,
              let model = raw["model"] as? String,
              let project = raw["project"] as? String else { return nil }
        slotStart = jsonDouble(raw["slotStart"])
        self.source = source
        self.model = model
        self.project = project
        inputTokens = jsonDouble(raw["inputTokens"])
        outputTokens = jsonDouble(raw["outputTokens"])
        reasoningTokens = jsonDouble(raw["reasoningTokens"])
        cachedTokens = jsonDouble(raw["cachedTokens"])
        totalTokens = jsonDouble(raw["totalTokens"])
        estimatedCost = jsonOptionalDouble(raw["estimatedCost"])
    }
}

struct AnalyticsRecords: Equatable {
    var items: [AnalyticsRecord] = []
    var total = 0
    var nextCursor: String?

    init() {}
    init(_ raw: Any?) {
        let d = raw as? [String: Any] ?? [:]
        items = (d["items"] as? [[String: Any]] ?? []).compactMap(AnalyticsRecord.init)
        total = jsonInt(d["total"])
        nextCursor = d["nextCursor"] as? String
    }
}

struct AnalyticsSnapshot: Equatable {
    var empty = true
    var range = "30d"
    var totals = AnalyticsTotals()
    var previous = AnalyticsTotals()
    var comparison: [String: Double] = [:]
    var cost = AnalyticsCost()
    var sessions = AnalyticsSessions()
    var series: [AnalyticsSeriesPoint] = []
    var heatmap: [AnalyticsHeatCell] = []
    var distributions = AnalyticsDistributions()
    var dimensions = AnalyticsDimensions()
    var collection = AnalyticsCollection()
    var records = AnalyticsRecords()

    static func decode(_ json: [String: Any]) -> AnalyticsSnapshot {
        var out = AnalyticsSnapshot()
        out.empty = json["empty"] as? Bool ?? false
        out.range = json["range"] as? String ?? "30d"
        out.totals = AnalyticsTotals(json["totals"])
        out.previous = AnalyticsTotals(json["previous"])
        if let comparisons = json["comparison"] as? [String: Any] {
            out.comparison = comparisons.reduce(into: [:]) { result, item in
                if let number = item.value as? NSNumber { result[item.key] = number.doubleValue }
            }
        }
        out.cost = AnalyticsCost(json["cost"])
        out.sessions = AnalyticsSessions(json["sessions"])
        out.series = (json["series"] as? [[String: Any]] ?? []).compactMap(AnalyticsSeriesPoint.init)
        out.heatmap = (json["heatmap"] as? [[String: Any]] ?? []).compactMap(AnalyticsHeatCell.init)
        out.distributions = AnalyticsDistributions(json["distributions"])
        out.dimensions = AnalyticsDimensions(json["dimensions"])
        out.collection = AnalyticsCollection(json["collection"])
        out.records = AnalyticsRecords(json["records"])
        return out
    }
}

// MARK: - Store

struct LiveAgentSession: Identifiable {
    let id: String
    let agentLabel: String
    let stateLabel: String
    let project: String
    let pid: Int32?
    let stateSince: Date
    let subagents: Int
    let winner: Bool

    init?(_ json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        agentLabel = json["agentLabel"] as? String ?? "Agent"
        stateLabel = json["stateLabel"] as? String ?? (json["state"] as? String ?? "运行中")
        project = json["project"] as? String ?? ""
        pid = (json["pid"] as? NSNumber).map { Int32($0.intValue) }
        stateSince = Date(timeIntervalSince1970: ((json["stateSince"] as? NSNumber)?.doubleValue ?? 0) / 1000)
        subagents = (json["subagents"] as? NSNumber)?.intValue ?? 0
        winner = json["winner"] as? Bool ?? false
    }
}

struct AgentConnection: Identifiable {
    let id: String
    let label: String
    let status: String
    let realtime: Bool
    let installed: Bool
    let permissions: Bool
    let quota: Bool
    let terminalFocus: Bool
    let verified: Bool
    let missingEvents: Int
    let trustReviewRequired: Bool

    init?(_ json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        label = json["label"] as? String ?? id
        verified = json["verified"] as? Bool ?? false
        installed = json["installed"] as? Bool ?? false
        let capabilities = json["capabilities"] as? [String: Any] ?? [:]
        realtime = capabilities["realtime"] as? Bool ?? false
        permissions = capabilities["permissions"] as? Bool ?? false
        quota = capabilities["quota"] as? Bool ?? false
        terminalFocus = capabilities["terminalFocus"] as? Bool ?? false
        let integration = json["integration"] as? [String: Any] ?? [:]
        status = integration["status"] as? String ?? "usage-only"
        missingEvents = (integration["missingEvents"] as? NSNumber)?.intValue ?? 0
        trustReviewRequired = integration["trustReviewRequired"] as? Bool ?? false
    }
}

struct AgentDoctorCheck: Identifiable {
    let id: String
    let agentId: String
    let label: String
    let message: String
    let level: String
    let repairable: Bool

    init?(_ json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        agentId = json["agentId"] as? String ?? ""
        label = json["label"] as? String ?? id
        message = json["message"] as? String ?? ""
        level = json["level"] as? String ?? "info"
        repairable = json["repairable"] as? Bool ?? false
    }
}

@MainActor
final class PanelStore: ObservableObject {
    @Published private(set) var summary = PanelSummary()
    @Published private(set) var analytics = AnalyticsSnapshot()
    @Published private(set) var quota = QuotaSnapshot()
    @Published private(set) var settings: [String: Any] = [:]
    @Published private(set) var liveSessions: [LiveAgentSession] = []
    @Published private(set) var agentConnections: [AgentConnection] = []
    @Published private(set) var doctorSummary: String = "检查中…"
    @Published private(set) var doctorChecks: [AgentDoctorCheck] = []
    @Published private(set) var loading = false
    @Published private(set) var lastError: String?
    /// 保留 `range` 这个名字给面板探针；它现在只控制统计页，概览始终是今天。
    @Published var range: String = "30d" { didSet { if range != oldValue { refreshAnalytics() } } }
    @Published private(set) var selectedSource: String?
    @Published private(set) var selectedModel: String?
    @Published private(set) var selectedProject: String?
    @Published private(set) var customFrom: String?
    @Published private(set) var customTo: String?

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
        get("/api/summary?range=today") { [weak self] json in
            guard let self, let json else { return }
            self.summary = Self.decodeSummary(json)
        }
        refreshAnalytics()
        get("/api/quota") { [weak self] json in
            guard let self, let json else { return }
            // PanelStore 是 @MainActor；只在面板打开后的刷新中查询 Launch Services。
            // RuntimeClient 的后台菜单栏轮询继续使用纯解码，不接触 AppKit。
            self.quota = QuotaSnapshot.decode(
                json,
                workBuddyInstalled: WorkBuddyInstallationDetector.isInstalled()
            )
        }
        get("/api/sessions") { [weak self] json in
            guard let self else { return }
            self.liveSessions = (json?["sessions"] as? [[String: Any]] ?? []).compactMap(LiveAgentSession.init)
        }
        refreshAgents()
    }

    func applyAnalyticsFilters(source: String?, model: String?, project: String?) {
        selectedSource = source
        selectedModel = model
        selectedProject = project
        refreshAnalytics()
    }

    func setCustomRange(from: String, to: String) {
        customFrom = from
        customTo = to
        if range == "custom" { refreshAnalytics() } else { range = "custom" }
    }

    func refreshAnalytics(cursor: String? = nil, append: Bool = false) {
        var components = URLComponents()
        components.path = "/api/analytics"
        var items = [URLQueryItem(name: "range", value: range.isEmpty ? "30d" : range)]
        if range == "custom" {
            if let customFrom { items.append(URLQueryItem(name: "from", value: customFrom)) }
            if let customTo { items.append(URLQueryItem(name: "to", value: customTo)) }
        }
        if let selectedSource { items.append(URLQueryItem(name: "source", value: selectedSource)) }
        if let selectedModel { items.append(URLQueryItem(name: "model", value: selectedModel)) }
        if let selectedProject { items.append(URLQueryItem(name: "project", value: selectedProject)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        components.queryItems = items
        guard let path = components.string else { return }
        get(path) { [weak self] json in
            guard let self, let json else { return }
            var next = AnalyticsSnapshot.decode(json)
            if append {
                next.records.items = self.analytics.records.items + next.records.items
            }
            self.analytics = next
        }
    }

    func loadMoreAnalytics() {
        guard let cursor = analytics.records.nextCursor else { return }
        refreshAnalytics(cursor: cursor, append: true)
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
        out.primaryMetric = "throughput"
        out.showCost = settings["showCost"] as? Bool ?? false
        out.coverage = json["coverage"] as? Double ?? 1
        out.baseline = json["baseline"] as? Double
        if let collection = json["collection"] as? [String: Any] {
            out.collectionComplete = collection["complete"] as? Bool ?? false
            out.deferredFiles = jsonInt(collection["deferredFiles"])
            if let scannedAt = collection["scannedAt"] as? String {
                out.collectionScannedAt = ISO8601DateFormatter().date(from: scannedAt)
            }
            for value in (collection["sources"] as? [String: Any] ?? [:]).values {
                guard let source = value as? [String: Any] else { continue }
                out.collectionTotalFiles += jsonInt(source["discoveredFiles"])
            }
            out.collectionProcessedFiles = max(0, out.collectionTotalFiles - out.deferredFiles)
        }

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

    func refreshAgents() {
        get("/api/agents") { [weak self] json in
            guard let self else { return }
            self.agentConnections = (json?["agents"] as? [[String: Any]] ?? []).compactMap(AgentConnection.init)
            let doctor = json?["doctor"] as? [String: Any]
            self.doctorSummary = doctor?["summary"] as? String ?? "暂不可用"
            self.doctorChecks = (doctor?["checks"] as? [[String: Any]] ?? []).compactMap(AgentDoctorCheck.init)
        }
    }

    func agentAction(_ agentId: String, _ action: String) {
        post("/api/agents", body: ["agentId": agentId, "action": action]) { [weak self] json in
            self?.agentConnections = (json?["agents"] as? [[String: Any]] ?? []).compactMap(AgentConnection.init)
            self?.loadSettings()
            self?.refreshAgents()
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
    static func credits(_ n: Double) -> String {
        if abs(n.rounded() - n) < 0.000_001 {
            return NumberFormatter.localizedString(from: NSNumber(value: n.rounded()), number: .decimal)
        }
        return String(format: "%.2f", n)
            .replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression)
    }

    static func tokens(_ n: Double) -> String {
        if n >= 1e9 { return String(format: "%.2fB", n / 1e9) }
        if n >= 1e6 { return String(format: "%.2fM", n / 1e6) }
        if n >= 1e3 { return String(format: "%.1fK", n / 1e3) }
        return String(Int(n.rounded()))
    }

    static func exactTokens(_ n: Double) -> String {
        "\(NumberFormatter.localizedString(from: NSNumber(value: n.rounded()), number: .decimal)) Token"
    }

    static func percent(_ x: Double) -> String {
        String(format: x >= 0.995 || x == 0 ? "%.0f%%" : "%.1f%%", x * 100)
    }

    static func duration(_ seconds: Int) -> String {
        let h = seconds / 3600, m = (seconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    static func exactDuration(_ seconds: Int) -> String {
        let safe = max(0, seconds)
        let h = safe / 3600, m = (safe % 3600) / 60, s = safe % 60
        return [h > 0 ? "\(h) 小时" : nil,
                m > 0 ? "\(m) 分钟" : nil,
                "\(s) 秒"]
            .compactMap { $0 }
            .joined(separator: " ")
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
