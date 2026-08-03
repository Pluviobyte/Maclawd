import SwiftUI

enum AnalyticsMetric: String, CaseIterable, Identifiable {
    case tokens, cost, active
    var id: String { rawValue }
    var title: String {
        switch self { case .tokens: "Token"; case .cost: "估算费用"; case .active: "时长" }
    }
}

enum DistributionKind: String, CaseIterable, Identifiable {
    case tools, models, projects
    var id: String { rawValue }
    var title: String {
        switch self { case .tools: "工具"; case .models: "模型"; case .projects: "项目" }
    }
}

struct StatsPage: View {
    @ObservedObject var store: PanelStore
    let disabled: Bool
    @State private var metric: AnalyticsMetric = .tokens
    @State private var distribution: DistributionKind = .tools
    @State private var distributionCost = false
    @State private var detailsExpanded = false
    @State private var filtersPresented = false
    @State private var customPresented = false

    private static let primaryRanges = [
        ("today", "今天"), ("24h", "24H"), ("7d", "7D"), ("30d", "30D"), ("90d", "90D"),
    ]
    private static let moreRanges = [
        ("yesterday", "昨天"), ("week", "本周"), ("last_week", "上周"),
        ("month", "本月"), ("year", "今年"), ("all", "全部"),
    ]

    private var filterCount: Int {
        [store.selectedSource, store.selectedModel, store.selectedProject].compactMap { $0 }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            rangeAndFilterBar
            if disabled {
                VStack(alignment: .leading, spacing: 5) {
                    Text("用量记录已关闭").font(.system(size: 12, weight: .medium))
                    Text("重新开启记录后，这里才会展示历史统计")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            } else if store.analytics.empty {
                VStack(alignment: .leading, spacing: 5) {
                    Text("这个区间没有数据").font(.system(size: 12, weight: .medium))
                    Text("使用 AI 编程工具后，统计会随本地扫描自动更新")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            } else {
                headline
                trendCard
                heatmapCard
                distributionCard
                detailCard
            }
        }
        .sheet(isPresented: $filtersPresented) {
            AnalyticsFilterSheet(store: store, isPresented: $filtersPresented)
        }
        .sheet(isPresented: $customPresented) {
            AnalyticsCustomRangeSheet(store: store, isPresented: $customPresented)
        }
    }

    private var rangeAndFilterBar: some View {
        HStack(spacing: 5) {
            ForEach(Self.primaryRanges, id: \.0) { id, label in
                Button { store.range = id } label: {
                    Text(label)
                        .font(.system(size: 10.5, weight: store.range == id ? .semibold : .regular))
                        .padding(.horizontal, 7).padding(.vertical, 4)
                        .background(Capsule().fill(store.range == id
                                                   ? PanelTheme.accent.opacity(0.16)
                                                   : Color.secondary.opacity(0.1)))
                        .foregroundStyle(store.range == id ? PanelTheme.accent : Color.primary)
                }.buttonStyle(.plain)
            }
            Menu {
                ForEach(Self.moreRanges, id: \.0) { id, label in
                    Button(label) { store.range = id }
                }
                Divider()
                Button("自定义…") { customPresented = true }
            } label: {
                Image(systemName: isPrimaryRange ? "ellipsis" : "calendar")
                    .frame(width: 24, height: 22)
                    .background(Capsule().fill(Color.secondary.opacity(0.1)))
                    .foregroundStyle(isPrimaryRange ? Color.primary : PanelTheme.accent)
            }.menuStyle(.borderlessButton)
            Button { filtersPresented = true } label: {
                Image(systemName: filterCount > 0 ? "line.3.horizontal.decrease.circle.fill"
                                                  : "line.3.horizontal.decrease.circle")
                    .overlay(alignment: .topTrailing) {
                        if filterCount > 0 {
                            Text("\(filterCount)").font(.system(size: 7, weight: .bold))
                                .foregroundStyle(.white).padding(2)
                                .background(Circle().fill(PanelTheme.accent)).offset(x: 4, y: -4)
                        }
                    }
            }
            .buttonStyle(.plain)
            .foregroundStyle(filterCount > 0 ? PanelTheme.accent : Color.secondary)
            .help("筛选工具、模型和项目")
        }
    }

    private var isPrimaryRange: Bool {
        Self.primaryRanges.contains { $0.0 == store.range }
    }

    private var headline: some View {
        SectionCard(title: "区间总览") {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(Fmt.tokens(store.analytics.totals.totalTokens))
                            .font(.system(size: 27, weight: .bold, design: .rounded))
                        comparisonLabel(key: "totalTokens", fallback: "总 Token")
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(store.analytics.cost.estimated.map { String(format: "$%.2f", $0) } ?? "—")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                        comparisonLabel(key: "estimatedCost", fallback: "估算费用")
                    }
                }
                DisclosureGroup(isExpanded: $detailsExpanded) {
                    VStack(spacing: 5) {
                        metricRow("输入", store.analytics.totals.inputTokens)
                        metricRow("输出", store.analytics.totals.outputTokens)
                        metricRow("推理", store.analytics.totals.reasoningTokens)
                        metricRow("缓存读取", store.analytics.totals.cachedTokens)
                        Divider().opacity(0.5)
                        sessionSummary
                        if store.analytics.cost.coverage < 0.999 {
                            Text("费用覆盖 \(Fmt.percent(store.analytics.cost.coverage))"
                                 + (store.analytics.cost.unpricedModels.isEmpty ? "" : " · 有未定价模型"))
                                .font(.system(size: 10)).foregroundStyle(.orange)
                        }
                    }.padding(.top, 6)
                } label: {
                    Text(detailsExpanded ? "收起明细" : "查看 Token 与会话明细")
                        .font(.system(size: 10.5)).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private var sessionSummary: some View {
        if store.analytics.sessions.available {
            VStack(spacing: 4) {
                HStack {
                    Label("活跃 \(Fmt.duration(store.analytics.sessions.totals.activeSeconds))", systemImage: "clock")
                    Spacer()
                    Text("墙钟 \(Fmt.duration(store.analytics.sessions.totals.durationSeconds))")
                }
                HStack {
                    Text("\(store.analytics.sessions.totals.sessions) 会话 · \(store.analytics.sessions.totals.messageCount) 消息")
                    Spacer()
                    Text("\(store.analytics.sessions.totals.userMessageCount) 条用户消息")
                }
            }.font(.system(size: 10.5)).foregroundStyle(.secondary)
        } else {
            Text("按模型筛选时无法归属会话时长")
                .font(.system(size: 10.5)).foregroundStyle(.secondary)
        }
    }

    private func comparisonLabel(key: String, fallback: String) -> some View {
        Group {
            if let delta = store.analytics.comparison[key] {
                Text("较上期 \(delta >= 0 ? "+" : "−")\(Fmt.percent(abs(delta)))")
            } else { Text(fallback) }
        }.font(.system(size: 9.5)).foregroundStyle(.secondary)
    }

    private func metricRow(_ label: String, _ value: Double) -> some View {
        HStack { Text(label); Spacer(); Text(Fmt.tokens(value)).fontDesign(.rounded) }
            .font(.system(size: 10.5))
    }

    private var trendCard: some View {
        SectionCard(title: "每日趋势") {
            VStack(spacing: 8) {
                Picker("趋势指标", selection: $metric) {
                    ForEach(AnalyticsMetric.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented).labelsHidden()
                AnalyticsTrendChart(points: store.analytics.series, metric: metric)
            }
        }
    }

    private var heatmapCard: some View {
        SectionCard(title: "分时活跃 · 周一至周日") {
            AnalyticsHeatmap(cells: store.analytics.heatmap, metric: metric)
        }
    }

    private var distributionItems: [AnalyticsDistributionItem] {
        switch distribution {
        case .tools: store.analytics.distributions.tools
        case .models: store.analytics.distributions.models
        case .projects: store.analytics.distributions.projects
        }
    }

    private var distributionCard: some View {
        SectionCard(title: "分布") {
            VStack(spacing: 8) {
                HStack {
                    Picker("维度", selection: $distribution) {
                        ForEach(DistributionKind.allCases) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented).labelsHidden()
                    Picker("值", selection: $distributionCost) {
                        Text("Token").tag(false); Text("估算费用").tag(true)
                    }.pickerStyle(.segmented).labelsHidden().frame(width: 112)
                }
                AnalyticsDistributionList(items: distributionItems, showCost: distributionCost)
            }
        }
    }

    private var detailCard: some View {
        SectionCard(title: "30 分钟明细") {
            VStack(spacing: 7) {
                ForEach(store.analytics.records.items) { row in
                    HStack(spacing: 7) {
                        Text(Self.slotFormatter.string(from: Date(timeIntervalSince1970: row.slotStart / 1000)))
                            .font(.system(size: 9.5, design: .monospaced)).foregroundStyle(.secondary)
                            .frame(width: 72, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(row.source) · \(row.project)").lineLimit(1)
                            Text(row.model).foregroundStyle(.secondary).lineLimit(1)
                        }.font(.system(size: 9.5))
                        Spacer(minLength: 4)
                        Text(Fmt.tokens(row.totalTokens)).font(.system(size: 10, design: .rounded))
                    }
                    if row.id != store.analytics.records.items.last?.id { Divider().opacity(0.35) }
                }
                if store.analytics.records.nextCursor != nil {
                    Button("加载更多（共 \(store.analytics.records.total) 条）") {
                        store.loadMoreAnalytics()
                    }.buttonStyle(.plain).font(.system(size: 10.5)).foregroundStyle(PanelTheme.accent)
                }
            }
        }
    }

    private static let slotFormatter: DateFormatter = {
        let value = DateFormatter(); value.dateFormat = "MM-dd HH:mm"; return value
    }()
}

struct AnalyticsTrendChart: View {
    let points: [AnalyticsSeriesPoint]
    let metric: AnalyticsMetric

    private func value(_ point: AnalyticsSeriesPoint) -> Double {
        switch metric {
        case .tokens: point.totalTokens
        case .cost: point.estimatedCost ?? 0
        case .active: Double(point.activeSeconds)
        }
    }

    var body: some View {
        let shown = Array(points.suffix(45))
        let peak = max(shown.map(value).max() ?? 1, 1)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .bottom, spacing: 1.5) {
                ForEach(shown) { point in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(PanelTheme.body.opacity(value(point) > 0 ? 0.82 : 0.12))
                        .frame(maxWidth: 9).frame(height: max(2, 48 * value(point) / peak))
                        .help("\(point.day) · \(formatted(point))")
                }
                Spacer(minLength: 0)
            }.frame(height: 48)
            HStack { Text(shown.first?.day ?? ""); Spacer(); Text(shown.last?.day ?? "") }
                .font(.system(size: 8.5)).foregroundStyle(.tertiary)
        }
    }

    private func formatted(_ point: AnalyticsSeriesPoint) -> String {
        switch metric {
        case .tokens: Fmt.tokens(point.totalTokens)
        case .cost: point.estimatedCost.map { String(format: "估算 $%.2f", $0) } ?? "未计价"
        case .active: Fmt.duration(point.activeSeconds)
        }
    }
}

struct AnalyticsHeatmap: View {
    let cells: [AnalyticsHeatCell]
    let metric: AnalyticsMetric
    private let columns = Array(repeating: GridItem(.fixed(9), spacing: 2), count: 24)

    private func value(_ cell: AnalyticsHeatCell) -> Double {
        switch metric {
        case .tokens: cell.totalTokens
        case .cost: cell.estimatedCost ?? 0
        case .active: Double(cell.activeSeconds)
        }
    }

    var body: some View {
        let peak = max(cells.map(value).max() ?? 1, 1)
        HStack(alignment: .top, spacing: 6) {
            VStack(spacing: 2) {
                ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { day in
                    Text(day).font(.system(size: 8)).foregroundStyle(.tertiary).frame(height: 9)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 2) {
                    ForEach(cells) { cell in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(PanelTheme.body.opacity(value(cell) == 0 ? 0.08
                                                          : 0.22 + 0.70 * value(cell) / peak))
                            .frame(width: 9, height: 9)
                            .help(heatHelp(cell))
                    }
                }
                HStack { Text("0"); Spacer(); Text("6"); Spacer(); Text("12"); Spacer(); Text("18"); Spacer(); Text("23") }
                    .frame(width: 262).font(.system(size: 8)).foregroundStyle(.tertiary)
            }
        }
    }

    private func heatHelp(_ cell: AnalyticsHeatCell) -> String {
        let prefix = "周\(cell.weekday) \(cell.hour):00 · "
        switch metric {
        case .tokens: return prefix + Fmt.tokens(cell.totalTokens)
        case .cost: return prefix + (cell.estimatedCost.map { String(format: "估算 $%.2f", $0) } ?? "未计价")
        case .active: return prefix + Fmt.duration(cell.activeSeconds)
        }
    }
}

struct AnalyticsDistributionList: View {
    let items: [AnalyticsDistributionItem]
    let showCost: Bool

    var body: some View {
        let shown = Array(items.prefix(8))
        let peak = max(shown.map { showCost ? ($0.estimatedCost ?? 0) : $0.totalTokens }.max() ?? 1, 1)
        VStack(spacing: 7) {
            ForEach(shown) { item in
                let value = showCost ? (item.estimatedCost ?? 0) : item.totalTokens
                VStack(spacing: 3) {
                    HStack {
                        Text(item.id).font(.system(size: 11)).lineLimit(1)
                        Spacer()
                        Text(showCost ? item.estimatedCost.map { String(format: "$%.2f", $0) } ?? "—"
                                      : Fmt.tokens(value))
                            .font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        Capsule().fill(Color.secondary.opacity(0.1))
                            .overlay(alignment: .leading) {
                                Capsule().fill(PanelTheme.body.opacity(0.75))
                                    .frame(width: max(2, geo.size.width * value / peak))
                            }
                    }.frame(height: 4)
                }
            }
        }
    }
}

struct AnalyticsFilterSheet: View {
    @ObservedObject var store: PanelStore
    @Binding var isPresented: Bool
    @State private var source: String?
    @State private var model: String?
    @State private var project: String?

    init(store: PanelStore, isPresented: Binding<Bool>) {
        self.store = store
        _isPresented = isPresented
        _source = State(initialValue: store.selectedSource)
        _model = State(initialValue: store.selectedModel)
        _project = State(initialValue: store.selectedProject)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("筛选统计").font(.headline)
            selector("工具", values: store.analytics.dimensions.sources, selection: $source)
            selector("模型", values: store.analytics.dimensions.models, selection: $model)
            selector("项目", values: store.analytics.dimensions.projects, selection: $project)
            HStack {
                Button("清除") { source = nil; model = nil; project = nil }
                Spacer(); Button("取消") { isPresented = false }
                Button("应用") {
                    store.applyAnalyticsFilters(source: source, model: model, project: project)
                    isPresented = false
                }.keyboardShortcut(.defaultAction)
            }
        }.padding(20).frame(width: 320)
    }

    private func selector(_ title: String, values: [String], selection: Binding<String?>) -> some View {
        HStack {
            Text(title).frame(width: 38, alignment: .leading)
            Picker(title, selection: selection) {
                Text("全部").tag(String?.none)
                ForEach(values, id: \.self) { Text($0).tag(Optional($0)) }
            }.labelsHidden().frame(maxWidth: .infinity)
        }.font(.system(size: 12))
    }
}

struct AnalyticsCustomRangeSheet: View {
    @ObservedObject var store: PanelStore
    @Binding var isPresented: Bool
    @State private var from = Calendar.current.date(byAdding: .day, value: -29, to: Date()) ?? Date()
    @State private var to = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("自定义时间范围").font(.headline)
            DatePicker("开始", selection: $from, displayedComponents: .date)
            DatePicker("结束", selection: $to, in: from..., displayedComponents: .date)
            HStack {
                Spacer(); Button("取消") { isPresented = false }
                Button("应用") {
                    store.setCustomRange(from: Self.formatter.string(from: from),
                                         to: Self.formatter.string(from: to))
                    isPresented = false
                }.keyboardShortcut(.defaultAction)
            }
        }.padding(20).frame(width: 320)
    }

    private static let formatter: DateFormatter = {
        let value = DateFormatter(); value.dateFormat = "yyyy-MM-dd"; return value
    }()
}
