import SwiftUI

/**
 面板。点菜单栏或双击桌宠弹出，**所有内容都在这里，不再跳浏览器**。

 三条产品判断写在代码里，因为它们很容易在后续改动中被无意抹掉：

 1. **最上面是角色在动，不是数字。** 这是 Maclawd 和别的用量工具唯一的
    结构性差异——它们打开是报表，这里打开先看见角色在干活。
 2. **额度排在 token 计数前面。** 包月用户不按 token 付费，
    「今天用了 124 万」没有决策价值；「5 小时用了 78%」直接决定
    现在敢不敢开一个大任务。
 3. **成本默认不进概览页。** 菜单栏密度档里有「今日成本」没问题——
    那是用户主动选的；概览页一天要瞥几十次，把钱摆那儿等于反复推送焦虑。
 */

enum PanelTab: String, CaseIterable, Identifiable {
    case overview, stats, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: return "概览"
        case .stats: return "统计"
        case .settings: return "设置"
        }
    }
}

enum PanelTheme {
    static let body = Color(nsColor: Design.bodyColor)
    static let accent = Color(nsColor: Design.accent)
    static let width: CGFloat = 360
    /// 高度上限。**超过就在页面内滚动，不加宽**——面板一旦要横向找东西
    /// 就不再是「一瞥」了。
    static let maxHeight: CGFloat = 560
}

struct PanelView: View {
    @ObservedObject var client: RuntimeClient
    @ObservedObject var store: PanelStore
    let repoRoot: URL
    var onOpenBrowser: (String) -> Void = { _ in }
    var onQuit: () -> Void = {}

    /// 初始页签。正常always是概览；`--show-panel=stats` 这类调试参数可以指定，
    /// 否则统计页和设置页没有任何自动化验证手段（popover 点不到）。
    @State private var tab: PanelTab = PanelTab(
        rawValue: CommandLine.arguments
            .first(where: { $0.hasPrefix("--show-panel=") })?
            .replacingOccurrences(of: "--show-panel=", with: "") ?? ""
    ) ?? .overview

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.5)
            ScrollView(.vertical, showsIndicators: false) {
                Group {
                    switch tab {
                    case .overview: OverviewPage(client: client, store: store)
                    case .stats: StatsPage(store: store)
                    case .settings:
                        SettingsPage(store: store, onOpenBrowser: onOpenBrowser, onQuit: onQuit)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .frame(maxHeight: PanelTheme.maxHeight)
            Divider().opacity(0.5)
            tabBar
        }
        .frame(width: PanelTheme.width)
        .onAppear { store.loadSettings() }
    }

    // MARK: 角色台头

    private var header: some View {
        VStack(spacing: 6) {
            CharacterStage(
                repoRoot: repoRoot,
                source: client.state.source,
                motion: client.state.motion,
                variant: client.state.variant
            )
            .frame(width: 104, height: 104)
            .allowsHitTesting(false)

            // 「它在干什么」——这一行比下面所有数字加起来都值钱，
            // 因为别的用量工具给不了：它们没有状态引擎。
            Text(client.state.disabled ? "用量记录已关闭"
                 : (client.state.name.isEmpty ? "连接中…" : client.state.name))
                .font(.system(size: 13, weight: .semibold))

            if !client.state.disabled && client.state.tokensPerMin > 0 {
                Text("每分钟 \(Fmt.tokens(Double(client.state.tokensPerMin)))")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 14)
        .padding(.bottom, 12)
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(PanelTab.allCases) { item in
                Button {
                    tab = item
                } label: {
                    Text(item.title)
                        .font(.system(size: 12, weight: tab == item ? .semibold : .regular))
                        .foregroundStyle(tab == item ? PanelTheme.accent : Color.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - 概览

private struct OverviewPage: View {
    @ObservedObject var client: RuntimeClient
    @ObservedObject var store: PanelStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            QuotaBlock(store: store)
            if client.state.disabled {
                disabledNotice
            } else if store.summary.empty {
                emptyNotice
            } else {
                todayBlock
                projectsBlock
                footnote
            }
        }
    }

    /// 关闭态**不显示任何历史数字**，即使数据还在盘上。用户关掉的是
    /// 「记录这件事」，继续展示旧数字会让人以为开关没生效。
    private var disabledNotice: some View {
        SectionCard(title: "今日") {
            Text("用量记录已关闭")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
    }

    private var emptyNotice: some View {
        SectionCard(title: "今日") {
            VStack(alignment: .leading, spacing: 4) {
                Text("还没有找到用量记录").font(.system(size: 12))
                Text("Maclawd 会在你使用 AI 编程工具后自动开始记录")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }

    private var todayBlock: some View {
        SectionCard(title: "今日") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Fmt.tokens(store.summary.primary))
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text(store.summary.primaryMetric == "throughput" ? "吞吐 tokens" : "计费 tokens")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                    Spacer()
                    if store.summary.showCost, let cost = store.summary.cost {
                        Text(String(format: "$%.2f", cost))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
                // 「比平时」用个人 14 天中位数，不是固定阈值——
                // 固定阈值会让重度用户永远看到红色，那是无意义的噪音。
                if let delta = store.summary.comparedToUsual {
                    Text("比平时\(delta >= 0 ? "多" : "少") \(Fmt.percent(abs(delta)))")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if store.summary.hoursAvailable && !store.summary.hours.isEmpty {
                    HourSparkline(values: store.summary.hours)
                }
            }
        }
    }

    private var projectsBlock: some View {
        Group {
            if !store.summary.byProject.isEmpty {
                SectionCard(title: "项目") {
                    VStack(spacing: 6) {
                        // 最多三行 + 「其他 N 个」。完整列表在统计页。
                        ForEach(store.summary.byProject.prefix(3)) { item in
                            HStack {
                                Text(item.id).font(.system(size: 12)).lineLimit(1)
                                Spacer()
                                Text(Fmt.tokens(item.billable))
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if store.summary.byProject.count > 3 {
                            HStack {
                                Text("其他 \(store.summary.byProject.count - 3) 个")
                                    .font(.system(size: 11)).foregroundStyle(.secondary)
                                Spacer()
                                Text(Fmt.tokens(store.summary.byProject.dropFirst(3)
                                    .reduce(0) { $0 + $1.billable }))
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    private var footnote: some View {
        HStack(spacing: 10) {
            Label("缓存 \(Fmt.percent(store.summary.hitRate))", systemImage: "bolt.horizontal")
            Label(Fmt.duration(store.summary.activeSeconds), systemImage: "clock")
            if store.summary.sessions > 0 {
                Label("\(store.summary.sessions) 会话", systemImage: "bubble.left")
            }
        }
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
        .labelStyle(.titleAndIcon)
    }
}

// MARK: - 额度

private struct QuotaBlock: View {
    @ObservedObject var store: PanelStore

    var body: some View {
        SectionCard(title: "订阅额度") {
            if store.quota.empty {
                emptyState
            } else {
                VStack(spacing: 10) {
                    ForEach(store.quota.sources) { source in
                        VStack(alignment: .leading, spacing: 7) {
                            if store.quota.sources.count > 1 {
                                Text(source.label)
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(source.windows) { window in
                                QuotaRow(window: window)
                            }
                            if let context = source.context {
                                Text("上下文已用 \(Int(context.usedPercent))%"
                                     + (context.windowSize.map { "（窗口 \(Int($0 / 1000))K）" } ?? ""))
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    /// 「没装通道」和「装了但还没数据」的文案完全不同——
    /// 混成一句会让用户对着一个永远不来的数字干等。
    @ViewBuilder private var emptyState: some View {
        switch store.quota.statusline {
        case .none, .foreign:
            VStack(alignment: .leading, spacing: 3) {
                Text("未开启").font(.system(size: 12))
                Text("在设置里开启后，Maclawd 就能看到 5 小时与本周额度")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        default:
            VStack(alignment: .leading, spacing: 3) {
                Text("等待第一次响应").font(.system(size: 12))
                Text("额度会在交互式会话产生第一次 API 响应后出现")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }
}

private struct QuotaRow: View {
    let window: QuotaWindow

    /// 不用红色——红色在 Maclawd 里已经是 `error` 的语言，额度用得多不是出错。
    /// 健康档用角色主色而不是绿色：绿色是仪表盘语言，主色让这一条
    /// 看起来是「桌宠身边的东西」而不是一个通用监控部件。
    private var tint: Color {
        guard let used = window.usedPercent else { return .secondary }
        if used >= 90 { return .orange }
        if used >= 70 { return PanelTheme.accent }
        return PanelTheme.body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(window.label)
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 46, alignment: .leading)

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.16))
                        if let used = window.usedPercent {
                            Capsule().fill(tint)
                                .frame(width: max(2, geo.size.width * used / 100))
                        }
                    }
                }
                .frame(height: 6)

                // 显示**已用**，和 Claude Code 给的口径一致（used_percentage），
                // 不做翻转——条的填充方向和百分比方向一致，读不反。
                Text(window.isReset ? "已重置" : "\(Int(window.usedPercent ?? 0))%")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(window.isReset ? Color.secondary : .primary)
                    .frame(width: 42, alignment: .trailing)
            }
            HStack(spacing: 6) {
                if let until = Fmt.until(window.resetAt), !window.isReset {
                    Text(until)
                }
                // 状态行只在交互式界面渲染，`claude -p` 与 CI 都不触发。
                // 所以必须老实标出「这不是实时的」，否则用户会当它是。
                if window.isQuiet {
                    Text("· \(max(1, window.staleSeconds / 60)) 分钟前的数据")
                }
            }
            .font(.system(size: 9.5))
            .foregroundStyle(.tertiary)
            .padding(.leading, 52)
        }
    }
}

// MARK: - 统计

private struct StatsPage: View {
    @ObservedObject var store: PanelStore

    private static let ranges: [(String, String)] = [
        ("today", "今天"), ("yesterday", "昨天"), ("week", "本周"),
        ("last_week", "上周"), ("month", "本月"), ("year", "今年"), ("all", "全部"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Self.ranges, id: \.0) { id, label in
                        Button { store.range = id } label: {
                            Text(label)
                                .font(.system(size: 11, weight: store.range == id ? .semibold : .regular))
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(
                                    Capsule().fill(store.range == id
                                                   ? PanelTheme.accent.opacity(0.16)
                                                   : Color.secondary.opacity(0.1))
                                )
                                .foregroundStyle(store.range == id ? PanelTheme.accent : Color.primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if store.summary.empty {
                Text("这个区间没有数据").font(.system(size: 12)).foregroundStyle(.secondary)
            } else {
                headline
                // 少于 3 天没有「趋势」可言。实测只有 1 天数据时，那根柱子会
                // 铺满整个宽度，读起来是一块色块而不是图表——比不画更糟。
                if store.summary.daily.count >= 3 {
                    SectionCard(title: "每日趋势") { DailyBars(points: store.summary.daily) }
                }
                BreakdownList(title: "项目", items: store.summary.byProject,
                              total: store.summary.billable)
                BreakdownList(title: "模型", items: store.summary.byModel,
                              total: store.summary.billable)
                BreakdownList(title: "工具", items: store.summary.bySource,
                              total: store.summary.billable)
            }
        }
    }

    private var headline: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Fmt.tokens(store.summary.primary))
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                Text(store.summary.primaryMetric == "throughput" ? "吞吐 tokens" : "计费 tokens")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Spacer()
            if store.summary.showCost, let cost = store.summary.cost {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(String(format: "$%.2f", cost))
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                    // 「估算」两个字不能省：本地价格表算的是 API 单价，与订阅费无关。
                    Text("估算成本").font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct BreakdownList: View {
    let title: String
    let items: [NamedBucket]
    let total: Double

    var body: some View {
        // 值为 0 的行不显示。`<synthetic>` 这类占位模型会带着一个 0 出现，
        // 是纯噪音——用户看到「某某 0」只会疑惑它为什么在这。
        let items = items.filter { $0.billable > 0 }
        return Group {
            if !items.isEmpty {
                SectionCard(title: title) {
                    VStack(spacing: 7) {
                        ForEach(items.prefix(8)) { item in
                            VStack(spacing: 3) {
                                HStack {
                                    Text(item.id).font(.system(size: 11.5)).lineLimit(1)
                                    Spacer()
                                    Text(Fmt.tokens(item.billable))
                                        .font(.system(size: 11.5, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Color.secondary.opacity(0.12))
                                        Capsule().fill(PanelTheme.body.opacity(0.75))
                                            .frame(width: total > 0
                                                   ? max(2, geo.size.width * item.billable / total)
                                                   : 2)
                                    }
                                }
                                .frame(height: 4)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - 小图形

private struct HourSparkline: View {
    let values: [Double]

    var body: some View {
        let peak = max(values.max() ?? 1, 1)
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .bottom, spacing: 1.5) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(PanelTheme.body.opacity(value > 0 ? 0.85 : 0.15))
                        .frame(height: max(2, 24 * value / peak))
                }
            }
            .frame(height: 24)
            HStack {
                Text("0"); Spacer(); Text("12"); Spacer(); Text("23")
            }
            .font(.system(size: 8)).foregroundStyle(.tertiary)
        }
    }
}

private struct DailyBars: View {
    let points: [DailyPoint]

    var body: some View {
        let shown = points.suffix(45)
        let peak = max(shown.map(\.throughput).max() ?? 1, 1)
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .bottom, spacing: 1.5) {
                ForEach(Array(shown)) { point in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(PanelTheme.body.opacity(0.85))
                        // 天数少时不让柱子撑满宽度。一根 10pt 宽的柱子读起来
                        // 仍然是柱子；铺满一整行的那个读起来是色块。
                        .frame(maxWidth: 10)
                        .frame(height: max(2, 44 * point.throughput / peak))
                        .help("\(point.day) · \(Fmt.tokens(point.throughput))")
                }
                Spacer(minLength: 0)
            }
            .frame(height: 44)
            Text("最近 \(shown.count) 天")
                .font(.system(size: 9)).foregroundStyle(.tertiary)
        }
    }
}

struct SectionCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(.secondary)
                .textCase(.none)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
