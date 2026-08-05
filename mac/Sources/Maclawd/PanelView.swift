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
    case overview, sessions, stats, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: return "概览"
        case .sessions: return "会话"
        case .stats: return "统计"
        case .settings: return "设置"
        }
    }
}

enum PanelTheme {
    static let body = Color(nsColor: Design.bodyColor)
    static let accent = Color(nsColor: Design.accent)
    static let width: CGFloat = 360

    /**
     **面板尺寸必须是常量。**

     此前用的是「高度跟着内容走、上限 560」。实测下来那是个明显的缺陷：
     切一次区间，行数变了，整个面板就跳一下。探针量到的实际数字——

     | 区间 | 窗口原点     | 尺寸    |
     | ---- | ------------ | ------- |
     | 今天 | (1126,187)   | 386×633 |
     | 昨天 | (1126,187)   | 386×577 |
     | 本月 | (1126,187)   | 386×728 |
     | 全部 | (944,60)     | 386×793 |

     AppKit 原点在左下，所以原点不变 + 高度变 = **顶边每次都在跳**，
     最大 151pt。到「全部」时面板高到放不下，AppKit 干脆把它整个搬到了
     另一个位置（左移 182、下移 127）。

     高度还会**自己**变：台头那行速率只在有速率时渲染，桌宠从工作转到发呆
     就矮 16pt——用户什么都没做，面板自己跳一下，更难理解。

     所以三段全部定高：台头、内容视口、页签栏。内容短就留白，
     内容长就在视口内滚。留白不好看，但面板乱跳是**不可用**。
     */
    static let headerHeight: CGFloat = 120
    static let contentHeight: CGFloat = 420
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
                    case .sessions: SessionsPage(store: store)
                    case .stats: StatsPage(store: store, disabled: client.state.disabled)
                    case .settings:
                        SettingsPage(
                            store: store,
                            repoRoot: repoRoot,
                            onOpenBrowser: onOpenBrowser,
                            onQuit: onQuit
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                // 内容比视口短时顶部对齐，不要垂直居中——居中会让
                // 「今日」这一块的位置随行数上下浮动，看起来还是在跳。
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            // 定高，不是上限。理由见 PanelTheme。
            .frame(height: PanelTheme.contentHeight)
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
            // SVG 的 45×45 viewBox 自带大量透明留白。104pt 画布会把顶部
            // 撑成一整块空区域；76pt 仍能看清动作，同时让数据更快进入视线。
            .frame(width: 76, height: 76)
            .allowsHitTesting(false)

            // 「它在干什么」——这一行比下面所有数字加起来都值钱，
            // 因为别的用量工具给不了：它们没有状态引擎。
            Text(client.state.disabled ? "用量记录已关闭"
                 : (client.state.name.isEmpty ? "连接中…" : client.state.name))
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)

            // 速率行**永远占位**。只在有速率时才渲染的话，桌宠从工作转到
            // 发呆会让台头矮一行，整个面板自己跳一下——用户什么都没做，
            // 那比点击引起的跳更难理解。没速率时留空串占住行高。
            Text(!client.state.disabled && client.state.tokensPerMin > 0
                 ? "每分钟 \(Fmt.tokens(Double(client.state.tokensPerMin)))"
                 : " ")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .frame(height: PanelTheme.headerHeight)
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

// MARK: - 实时会话

private struct SessionsPage: View {
    @ObservedObject var store: PanelStore
    @State private var now = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("实时会话").font(.system(size: 13, weight: .semibold))
                Spacer()
                Text("\(store.liveSessions.count) 个会话")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            if store.liveSessions.isEmpty {
                SectionCard(title: "当前") {
                    Text("暂无运行中的项目。连接 Claude Code 或 Codex 后，项目状态会出现在这里。")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            } else {
                ForEach(Array(projectGroups.enumerated()), id: \.element.id) { index, group in
                    if index > 0 {
                        Divider().opacity(0.45).padding(.vertical, 2)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(group.name)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            if !group.path.isEmpty {
                                Text(group.path)
                                    .font(.system(size: 9.5))
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .accessibilityLabel("完整路径 \(group.path)")
                            }
                        }

                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(group.sessions.enumerated()), id: \.element.id) { sessionIndex, session in
                                if sessionIndex > 0 {
                                    Divider().opacity(0.28).padding(.vertical, 7)
                                }
                                sessionRow(session)
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            now = Date()
            store.refresh()
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { now = $0 }
    }

    private var projectGroups: [LiveProjectGroup] {
        LiveProjectGroup.make(from: store.liveSessions)
    }

    private func sessionRow(_ session: LiveAgentSession) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.agentLabel)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.primary)
            HStack(spacing: 6) {
                Circle()
                    .fill(stateColor(session))
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
                Text(session.stateLabel)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(stateColor(session))
                Spacer(minLength: 8)
                Text(auxiliaryText(session))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func stateColor(_ session: LiveAgentSession) -> Color {
        if session.state == "error" { return .red }
        if session.state == "needs_owner" { return .orange }
        return .secondary
    }

    private func auxiliaryText(_ session: LiveAgentSession) -> String {
        let duration = elapsed(session.stateSince)
        guard session.subagents > 0 else { return duration }
        return "\(duration) · \(session.subagents) 个子代理"
    }

    private func elapsed(_ date: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return "刚刚" }
        return Fmt.duration(seconds)
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
            } else if !store.summary.primaryAvailable {
                indexingTodayNotice
            } else {
                todayBlock
                projectsBlock
                // 内容比视口短时把脚注推到底，空白留在中间而不是堆在末尾。
                // 顺带让脚注变成一条固定的底栏——上面的行数怎么变它都不动。
                Spacer(minLength: 0)
                footnote
            }
        }
        // ScrollView 会给内容无限高度，Spacer 在里面撑不开。
        // 给一个最小高度，Spacer 才知道要占多少。
        .frame(minHeight: PanelTheme.contentHeight - 28, alignment: .top)
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
                Text(store.summary.collectionComplete ? "还没有找到用量记录" : "正在建立用量索引")
                    .font(.system(size: 12))
                Text(store.summary.collectionComplete
                     ? "Maclawd 会在你使用 AI 编程工具后自动开始记录"
                     : "当前尚无已索引记录 · 待处理 \(store.summary.deferredFiles) 个文件")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }

    /// 历史索引里已有记录，并不代表它已经走到今天。此时 throughput 的 0
    /// 是解码默认值，不是准确的「今天没用过」，所以只展示当前索引状态。
    private var indexingTodayNotice: some View {
        SectionCard(title: "今日") {
            VStack(alignment: .leading, spacing: 8) {
                Text("正在索引今天的用量")
                    .font(.system(size: 12, weight: .medium))
                if let progress = store.summary.collectionProgress {
                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                        .accessibilityLabel("历史索引进度")
                        .accessibilityValue(Fmt.percent(progress))
                }
                Text(indexingProgressTitle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(.orange)
                Text("还剩 \(store.summary.deferredFiles) 个文件，正在自动继续处理。找到今天的记录后会显示准确 Token。")
                    .font(.system(size: 9.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var todayBlock: some View {
        SectionCard(title: "今日") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Fmt.tokens(store.summary.primary))
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text((store.summary.collectionComplete ? "" : "已统计的 ") + "总 Token")
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
                if store.summary.collectionComplete, let delta = store.summary.comparedToUsual {
                    Text("比平时\(delta >= 0 ? "多" : "少") \(Fmt.percent(abs(delta)))")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if !store.summary.collectionComplete {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(indexingProgressTitle)
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(.orange)
                        Text("还剩 \(store.summary.deferredFiles) 个文件，\(store.summary.nextCollectionScanLabel)。完成前显示的是已找到的用量，最终数字可能更高。")
                            .font(.system(size: 9.5))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
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
                SectionCard(title: store.summary.collectionComplete ? "项目" : "项目 · 已统计") {
                    VStack(spacing: 6) {
                        // 最多三行 + 「其他 N 个」。完整列表在统计页。
                        ForEach(store.summary.byProject.prefix(3)) { item in
                            HStack {
                                Text(item.id).font(.system(size: 12)).lineLimit(1)
                                Spacer()
                                Text(Fmt.tokens(item.throughput))
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
                                        .reduce(0) { $0 + $1.throughput }))
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

    private var indexingProgressTitle: String {
        guard let progress = store.summary.collectionProgress else { return "正在整理历史用量" }
        return "正在整理历史用量 · 已完成 \(Fmt.percent(progress))"
    }
}

// MARK: - 额度

private struct QuotaBlock: View {
    @ObservedObject var store: PanelStore
    @State private var workBuddyBonusExpanded = false

    var body: some View {
        SectionCard(title: "订阅额度") {
            VStack(alignment: .leading, spacing: 10) {
                if store.quota.empty {
                    emptyState
                } else {
                    ForEach(store.quota.sources) { source in
                        VStack(alignment: .leading, spacing: 7) {
                            // 来源是额度的一部分，不是只有多来源时才需要的分组标题。
                            // 只显示「本周 51%」会让用户无法判断它属于 Claude 还是 Codex。
                            Text(source.label)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.primary)
                            if source.id == "workbuddy" {
                                workBuddyQuota(source)
                            } else {
                                ForEach(source.windows) { window in
                                    QuotaRow(window: window)
                                }
                            }
                            if let context = source.context {
                                Text("上下文剩余 \(Int(context.remainingPercent.rounded()))%"
                                     + (context.windowSize.map { "（窗口 \(Int($0 / 1000))K）" } ?? ""))
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if store.quota.workBuddy.installed
                    && (!store.quota.sources.contains(where: { $0.id == "workbuddy" })
                        || store.quota.workBuddy.lastErrorCode != nil) {
                    workBuddyStatus
                }
            }
        }
    }

    @ViewBuilder private func workBuddyQuota(_ source: QuotaSource) -> some View {
        let presentation = WorkBuddyQuotaPresentation(source: source)
        if let base = presentation.base {
            QuotaRow(window: base)
        } else {
            ForEach(presentation.baseDetails) { window in
                QuotaRow(window: window)
            }
        }
        if presentation.bonus != nil || !presentation.bonusDetails.isEmpty {
            Button {
                withAnimation(.easeInOut(duration: 0.16)) {
                    workBuddyBonusExpanded.toggle()
                }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    if let bonus = presentation.bonus {
                        QuotaRow(window: bonus, deadlineAction: .expire)
                    } else {
                        Text("额外额度 · 数据暂不完整")
                            .font(.system(size: 11, weight: .medium))
                    }
                    HStack(spacing: 5) {
                        Text("\(presentation.bonusDetails.count) 个额外积分包 · 点击查看明细")
                        Spacer(minLength: 4)
                        Image(systemName: workBuddyBonusExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 8.5, weight: .semibold))
                    }
                    .font(.system(size: 9.5))
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 78)
                    .padding(.trailing, 2)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if workBuddyBonusExpanded {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(presentation.bonusDetails.enumerated()), id: \.element.id) { index, window in
                        VStack(alignment: .leading, spacing: 2) {
                            QuotaRow(
                                window: window,
                                labelOverride: "额外包 \(index + 1)",
                                deadlineAction: .expire
                            )
                            Text(window.label)
                                .font(.system(size: 9.5))
                                .foregroundStyle(.tertiary)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.leading, 78)
                        }
                    }
                }
                .padding(.top, 6)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var workBuddyStatus: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("WorkBuddy")
                .font(.system(size: 11, weight: .semibold))
            Text(workBuddyStatusTitle)
                .font(.system(size: 11, weight: .medium))
            Text("使用本机 WorkBuddy 登录状态查询计费服务；Token 只在请求期间驻留内存。")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var workBuddyStatusTitle: String {
        guard store.quota.enabled else { return "开启额度读取后自动显示积分" }
        switch store.quota.workBuddy.lastErrorCode {
        case "ENOAUTH": return "请先登录 WorkBuddy"
        case "EAUTH": return "WorkBuddy 登录状态已失效"
        case "ENODATA": return "WorkBuddy 暂未返回可用积分"
        case "ERATELIMIT": return "WorkBuddy 查询频繁，稍后自动重试"
        case .some: return "WorkBuddy 积分读取失败，稍后自动重试"
        case .none: return "正在读取 WorkBuddy 积分"
        }
    }

    /// 「没装通道」和「装了但还没数据」的文案完全不同——
    /// 混成一句会让用户对着一个永远不来的数字干等。
    @ViewBuilder private var emptyState: some View {
        if !store.quota.enabled {
            VStack(alignment: .leading, spacing: 3) {
                Text("未开启").font(.system(size: 12))
                Text("在设置里开启后，Maclawd 会读取 Codex、Claude Code 与 WorkBuddy 额度")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        } else {
            switch store.quota.statusline {
            case .foreign:
                VStack(alignment: .leading, spacing: 3) {
                    Text("正在读取 Codex 额度").font(.system(size: 12))
                    Text("Claude Code 的自定义状态行未被修改，可在设置中确认兼容")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            default:
                VStack(alignment: .leading, spacing: 3) {
                    Text("等待第一次响应").font(.system(size: 12))
                    Text("Codex 会自动刷新；Claude Code 在交互式会话首次响应后出现")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct QuotaRow: View {
    let window: QuotaWindow
    var labelOverride: String? = nil
    var deadlineAction: QuotaDeadlineAction = .reset

    /// 不用红色——红色在 Maclawd 里已经是 `error` 的语言，额度用得多不是出错。
    /// 健康档用角色主色而不是绿色：绿色是仪表盘语言，主色让这一条
    /// 看起来是「桌宠身边的东西」而不是一个通用监控部件。
    private var tint: Color {
        guard let remaining = window.remainingPercent else { return .secondary }
        if remaining <= 10 { return .orange }
        if remaining <= 30 { return PanelTheme.accent }
        return PanelTheme.body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(labelOverride ?? window.label)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                    .frame(width: 72, alignment: .leading)

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.16))
                        if let remaining = window.remainingPercent, remaining > 0 {
                            Capsule().fill(tint)
                                .frame(width: max(2, geo.size.width * remaining / 100))
                        }
                    }
                }
                .frame(height: 6)

                // 官方返回 used_percentage；这里翻转为用户真正要决策的“还剩多少”。
                // 进度条和文字都使用剩余值，避免方向相反。
                Text(window.isReset
                     ? "已重置"
                     : "剩余 \(Int((window.remainingPercent ?? 0).rounded()))%")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(window.isReset ? Color.secondary : .primary)
                    .frame(width: 68, alignment: .trailing)
            }
            HStack(spacing: 6) {
                if let remaining = window.remaining, let limit = window.limit {
                    Text("\(Fmt.credits(remaining)) / \(Fmt.credits(limit)) Credits")
                }
                if let until = Fmt.until(window.resetAt, action: deadlineAction), !window.isReset {
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
            .padding(.leading, 78)
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
