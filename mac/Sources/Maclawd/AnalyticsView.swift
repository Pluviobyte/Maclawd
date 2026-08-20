import SwiftUI

enum AnalyticsMetric: String, CaseIterable, Identifiable {
    case tokens, cost, active
    var id: String { rawValue }
    var title: String {
        switch self { case .tokens: "Token"; case .cost: "估算费用"; case .active: "时长" }
    }

    func value(totalTokens: Double, estimatedCost: Double?, activeSeconds: Int) -> Double {
        switch self {
        case .tokens: totalTokens
        case .cost: estimatedCost ?? 0
        case .active: Double(activeSeconds)
        }
    }

    func exactText(totalTokens: Double, estimatedCost: Double?, activeSeconds: Int) -> String {
        switch self {
        case .tokens: Fmt.exactTokens(totalTokens)
        case .cost: estimatedCost.map { String(format: "估算 $%.4f", $0) } ?? "未计价"
        case .active: Fmt.exactDuration(activeSeconds)
        }
    }
}

enum DistributionKind: String, CaseIterable, Identifiable {
    case tools, projects, models
    var id: String { rawValue }
    var title: String {
        switch self { case .tools: "工具"; case .models: "模型"; case .projects: "项目" }
    }
}

struct StatsPage: View {
    @ObservedObject var store: PanelStore
    let disabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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

    /**
     区间条上所有胶囊的横向内边距。

     **7 会放不下。** 面板固定 360、去掉边距只剩 328，而五个区间胶囊 + ⋯ + 工具
     筛选 + 漏斗在 padding 7 时实测要 340（WorkBuddy）到 357（GitHub Copilot CLI），
     连「全部工具」这个默认态都会被挤成一个省略号。降到 5 之后最宽的真实工具名
     还剩 12pt 余量，只有 GitHub Copilot CLI 会走截断。
     */
    private static let chipPadding: CGFloat = 5

    /// 工具已经提到区间条上自述状态，漏斗只代表模型和项目。
    private var filterCount: Int {
        [store.selectedModel, store.selectedProject].compactMap { $0 }.count
    }

    private var toolBinding: Binding<String?> {
        Binding(get: { store.selectedSource }, set: { store.selectTool($0) })
    }

    private var toolFullName: String? {
        store.selectedSource.map { store.analytics.dimensions.label(forSource: $0) }
    }

    /**
     采集完整度按当前工具收窄。

     只筛 Codex 时，Cursor 还没索引完不该让 Codex 的数字被标成「已统计」——
     那些文件根本不参与这次统计。缺少该来源状态时回落到全局值，宁可偏保守。
     */
    private var scopedComplete: Bool {
        guard let source = store.selectedSource else { return store.analytics.collection.complete }
        return store.analytics.collection.sources[source]?.complete
            ?? store.analytics.collection.complete
    }

    private var scopedProgress: Double? {
        guard let source = store.selectedSource else { return store.analytics.collection.progress }
        return store.analytics.collection.sources[source]?.progress
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
                emptyState
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
                        .padding(.horizontal, Self.chipPadding).padding(.vertical, 4)
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
            toolMenu
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
            .help("筛选模型和项目")
        }
    }

    /**
     工具筛选。位置在日期区间右侧，因为「只看 Codex」和切区间是同一种浏览动作，
     每天要用好几次；埋在筛选 sheet 里等于每次两步。

     **必须显示当前选中的工具名，不能只用图标加角标。** 筛选一旦生效，页面上每个
     数字都被它改过了，看不见筛的是谁就等于界面在暗中说谎。

     宽度是硬约束：面板固定 360，去掉边距只剩 328，区间条已占约 241。所以条上用
     去尾缀短名（Claude Code → Claude），全称留在菜单项和 VoiceOver 里。
     */
    private var toolMenu: some View {
        let active = store.selectedSource != nil
        return Menu {
            Picker("工具", selection: toolBinding) {
                Text("全部工具").tag(String?.none)
                ForEach(store.analytics.dimensions.sources, id: \.self) { id in
                    Text(store.analytics.dimensions.label(forSource: id)).tag(Optional(id))
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            HStack(spacing: 2) {
                Text(store.selectedSource.map { store.analytics.dimensions.shortLabel(forSource: $0) }
                     ?? "全部工具")
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down").font(.system(size: 7, weight: .semibold))
            }
            .font(.system(size: 10.5, weight: active ? .semibold : .regular))
            .padding(.horizontal, Self.chipPadding).padding(.vertical, 4)
            .background(Capsule().fill(active ? PanelTheme.accent.opacity(0.16)
                                              : Color.secondary.opacity(0.1)))
            .foregroundStyle(active ? PanelTheme.accent : Color.primary)
        }
        // 必须是 .button 而不是旁边 ⋯ 用的 .borderlessButton：后者会把自定义标签的
        // 胶囊底和内边距整个丢掉，只渲染文字，并且自己在左侧画一个箭头。
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityLabel("按工具筛选")
        .accessibilityValue(toolFullName ?? "全部工具")
        .help(toolFullName.map { "只看 \($0)" } ?? "按工具筛选统计")
    }

    /// 区间没有数据时，先说清是不是筛选造成的。把「筛掉了」说成「没有数据」
    /// 会让用户以为扫描坏了，然后去点重新扫描——那什么也修不好。
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let name = toolFullName {
                Text("当前筛选下这个区间没有数据").font(.system(size: 12, weight: .medium))
                Text(scopedComplete
                     ? "「\(name)」在这个区间没有记录，换个区间或清除筛选看看"
                     : "「\(name)」的索引还在建立，稍后可能出现记录")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                Button("清除工具筛选") { store.selectTool(nil) }
                    .buttonStyle(.plain)
                    .font(.system(size: 10.5))
                    .foregroundStyle(PanelTheme.accent)
                    .padding(.top, 1)
            } else {
                Text(scopedComplete ? "这个区间没有数据" : "正在建立用量索引")
                    .font(.system(size: 12, weight: .medium))
                Text(scopedComplete
                     ? "使用 AI 编程工具后，统计会随本地扫描自动更新"
                     : "当前尚无已索引记录 · 待处理 \(store.analytics.collection.deferredFiles) 个文件")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
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
                        comparisonLabel(
                            key: "totalTokens",
                            fallback: "总 Token",
                            partial: "当前已统计 Token"
                        )
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(store.analytics.cost.estimated.map {
                            String(format: "$%.2f", $0)
                        } ?? "—")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                        comparisonLabel(
                            key: "estimatedCost",
                            fallback: "估算费用",
                            partial: "当前估算费用"
                        )
                    }
                }
                if !scopedComplete {
                    indexingProgress
                }
                Button {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                        detailsExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 5) {
                        Text(detailsExpanded ? "收起明细" : "查看 Token 与会话明细")
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8.5, weight: .semibold))
                            .rotationEffect(.degrees(detailsExpanded ? 90 : 0))
                    }
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(detailsExpanded
                                    ? "收起 Token 与会话明细"
                                    : "查看 Token 与会话明细")
                .accessibilityValue(detailsExpanded ? "已展开" : "已收起")

                if detailsExpanded {
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
                    }
                    .padding(.top, 1)
                    .transition(.opacity.combined(with: .move(edge: .top)))
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

    private var indexingProgress: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(toolFullName.map { "\($0) 索引进度" } ?? "历史索引进度")
                Spacer()
                Text(scopedProgress.map(Fmt.percent) ?? "处理中")
                    .fontWeight(.semibold)
            }
            .font(.system(size: 10.5))
            if let progress = scopedProgress {
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(PanelTheme.accent)
                    .accessibilityLabel("历史索引进度")
                    .accessibilityValue(Fmt.percent(progress))
            }
            Text("当前显示已完成索引记录的准确值；索引完成后自动更新为区间总额")
                .font(.system(size: 9.5))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private func comparisonLabel(key: String, fallback: String, partial: String) -> some View {
        Group {
            if scopedComplete, let delta = store.analytics.comparison[key] {
                Text("较上期 \(delta >= 0 ? "+" : "−")\(Fmt.percent(abs(delta)))")
            } else { Text(scopedComplete ? fallback : partial) }
        }.font(.system(size: 9.5)).foregroundStyle(.secondary)
    }

    private func metricRow(_ label: String, _ value: Double) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(Fmt.tokens(value))
                .fontDesign(.rounded)
        }
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
                HStack(spacing: 16) {
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
    @State private var hoveredDay: String?

    private func value(_ point: AnalyticsSeriesPoint) -> Double {
        metric.value(totalTokens: point.totalTokens, estimatedCost: point.estimatedCost,
                     activeSeconds: point.activeSeconds)
    }

    var body: some View {
        let shown = Array(points.suffix(45))
        let peak = max(shown.map(value).max() ?? 1, 1)
        VStack(alignment: .leading, spacing: 4) {
            Group {
                if let hovered = shown.first(where: { $0.day == hoveredDay }) {
                    Text("\(hovered.day) · \(formattedExact(hovered))")
                        .foregroundStyle(.primary)
                } else {
                    Text("悬浮柱状图查看具体数值")
                        .foregroundStyle(.tertiary)
                }
            }
            .font(.system(size: 9.5, weight: .medium))
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 14, alignment: .leading)

            HStack(alignment: .bottom, spacing: 1.5) {
                ForEach(shown) { point in
                    chartBar(point, peak: peak)
                }
                Spacer(minLength: 0)
            }
            .frame(height: 48)
            HStack { Text(shown.first?.day ?? ""); Spacer(); Text(shown.last?.day ?? "") }
                .font(.system(size: 8.5)).foregroundStyle(.tertiary)
        }
    }

    private func chartBar(_ point: AnalyticsSeriesPoint, peak: Double) -> some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(PanelTheme.body.opacity(value(point) > 0 ? 0.82 : 0.12))
            .frame(maxWidth: 9)
            .frame(height: max(2, 48 * value(point) / peak))
            .onHover { hovering in
                if hovering { hoveredDay = point.day }
                else if hoveredDay == point.day { hoveredDay = nil }
            }
    }

    private func formattedExact(_ point: AnalyticsSeriesPoint) -> String {
        metric.exactText(totalTokens: point.totalTokens, estimatedCost: point.estimatedCost,
                         activeSeconds: point.activeSeconds)
    }
}

struct AnalyticsHeatmap: View {
    let cells: [AnalyticsHeatCell]
    let metric: AnalyticsMetric
    @State private var hoveredCellID: String?
    private let columns = Array(repeating: GridItem(.fixed(9), spacing: 2), count: 24)

    private func value(_ cell: AnalyticsHeatCell) -> Double {
        metric.value(totalTokens: cell.totalTokens, estimatedCost: cell.estimatedCost,
                     activeSeconds: cell.activeSeconds)
    }

    var body: some View {
        let peak = max(cells.map(value).max() ?? 1, 1)
        VStack(alignment: .leading, spacing: 4) {
            Group {
                if let hovered = cells.first(where: { $0.id == hoveredCellID }) {
                    Text(heatText(hovered)).foregroundStyle(.primary)
                } else {
                    Text("悬浮热力格查看具体数值").foregroundStyle(.tertiary)
                }
            }
            .font(.system(size: 9.5, weight: .medium))
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 14, alignment: .leading)

            HStack(alignment: .top, spacing: 6) {
                VStack(spacing: 2) {
                    ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { day in
                        Text(day).font(.system(size: 8)).foregroundStyle(.tertiary).frame(height: 9)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 2) {
                        ForEach(cells) { cell in
                            heatCell(cell, peak: peak)
                        }
                    }
                    HStack { Text("0"); Spacer(); Text("6"); Spacer(); Text("12"); Spacer(); Text("18"); Spacer(); Text("23") }
                        .frame(width: 262).font(.system(size: 8)).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func heatCell(_ cell: AnalyticsHeatCell, peak: Double) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(PanelTheme.body.opacity(value(cell) == 0 ? 0.08
                                          : 0.22 + 0.70 * value(cell) / peak))
            .frame(width: 9, height: 9)
            .onHover { hovering in
                if hovering { hoveredCellID = cell.id }
                else if hoveredCellID == cell.id { hoveredCellID = nil }
            }
    }

    private func heatText(_ cell: AnalyticsHeatCell) -> String {
        let period: String
        if let start = cell.dateStart, let end = cell.dateEnd, let count = cell.dateCount {
            let startParts = start.split(separator: "-")
            let endParts = end.split(separator: "-")
            let sameYear = startParts.first == endParts.first
            let shownStart = sameYear && startParts.count == 3
                ? startParts.dropFirst().joined(separator: "-") : start
            let shownEnd = sameYear && endParts.count == 3
                ? endParts.dropFirst().joined(separator: "-") : end
            period = start == end ? shownStart : "\(shownStart)–\(shownEnd) · \(count) 个日期"
        } else {
            period = "周\(cell.weekday)"
        }
        let prefix = String(format: "%@ %02d:00 · ", period, cell.hour)
        return prefix + metric.exactText(totalTokens: cell.totalTokens,
                                         estimatedCost: cell.estimatedCost,
                                         activeSeconds: cell.activeSeconds)
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

/// 工具筛选不在这里——它在统计页区间条上。同一个状态两个入口必然走向不同步。
struct AnalyticsFilterSheet: View {
    @ObservedObject var store: PanelStore
    @Binding var isPresented: Bool
    @State private var model: String?
    @State private var project: String?

    init(store: PanelStore, isPresented: Binding<Bool>) {
        self.store = store
        _isPresented = isPresented
        _model = State(initialValue: store.selectedModel)
        _project = State(initialValue: store.selectedProject)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("筛选模型和项目").font(.headline)
            selector("模型", values: store.analytics.dimensions.models, selection: $model)
            selector("项目", values: store.analytics.dimensions.projects, selection: $project)
            HStack {
                Button("清除") { model = nil; project = nil }
                Spacer(); Button("取消") { isPresented = false }
                Button("应用") {
                    store.applyAnalyticsFilters(model: model, project: project)
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
