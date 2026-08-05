import AppKit
import SwiftUI

/**
 设置页。

 **每一项都写清代价，不只写功能。** 会写用户另一个工具配置文件的开关，
 必须明说写的是什么、写到哪——含糊其辞会失去信任，而信任是这类
 「读你本机日志」的工具唯一的资产。
 */
struct SettingsPage: View {
    @ObservedObject var store: PanelStore
    let repoRoot: URL
    var onOpenBrowser: (String) -> Void
    var onQuit: () -> Void

    @State private var statuslineBusy = false
    @State private var confirmingReset = false
    @State private var rescanNote: String?
    @State private var codexPetState: CodexPetInstallationState = .ready
    @State private var codexPetNote: String?
    @State private var confirmingPetUpdate = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            usageSection
            agentConnectionSection
            quotaSection
            alertSection
            menuBarSection
            codexPetSection
            dangerSection
        }
        .onAppear { refreshCodexPetState() }
        .alert("替换 Codex 中的 Maclawd？", isPresented: $confirmingPetUpdate) {
            Button("取消", role: .cancel) {}
            Button("替换") { installCodexPet(replacing: true) }
        } message: {
            Text("检测到已安装的版本不同。只会替换 ~/.codex/pets/maclawd 中可识别的 Maclawd 宠物包。")
        }
    }

    private var agentConnectionSection: some View {
        SectionCard(title: "Agent 连接") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Doctor：\(store.doctorSummary)")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(store.doctorSummary.contains("修复") ? .orange : PanelTheme.accent)
                ForEach(store.doctorChecks.filter { $0.level != "ok" }) { check in
                    HStack(alignment: .top, spacing: 6) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(check.label).font(.system(size: 10.5, weight: .medium))
                            Text(check.message).font(.system(size: 9.5)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if check.repairable {
                            Button("修复") { store.agentAction(check.agentId, "repair") }
                                .font(.system(size: 10))
                        }
                    }
                }
                ForEach(store.agentConnections) { agent in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(agent.label).font(.system(size: 11.5, weight: .semibold))
                            Text(statusTitle(agent.status)).font(.system(size: 9.5)).foregroundStyle(.secondary)
                            Spacer()
                            if agent.realtime, agent.status == "connected" {
                                Button("移除") { store.agentAction(agent.id, "uninstall") }.font(.system(size: 10))
                            } else if agent.realtime {
                                Button(agent.status == "partial" ? "修复" : "连接") {
                                    store.agentAction(agent.id, agent.status == "partial" ? "repair" : "install")
                                }.font(.system(size: 10))
                            }
                        }
                        HStack(spacing: 5) {
                            capability("用量", active: true)
                            capability("实时", active: agent.realtime)
                            capability("权限", active: agent.permissions)
                            capability("跳转", active: agent.terminalFocus)
                            capability("额度", active: agent.quota)
                            if agent.verified { Text("已验证").font(.system(size: 8.5)).foregroundStyle(PanelTheme.accent) }
                        }
                        if agent.id == "codex", agent.trustReviewRequired {
                            Text("安装后请在 Codex /hooks 中确认一次信任。JSONL 仅作尽力而为的后备通道。")
                                .font(.system(size: 9.5)).foregroundStyle(.tertiary)
                        }
                    }
                }
                SwitchRow(
                    title: "在桌宠旁批准权限",
                    detail: "Claude Code 与 Codex 请求权限时显示原生卡片；超时不表态，仍回到 Agent 自己的确认流程。",
                    isOn: store.bool("permissionBubble")
                ) { store.setSetting("permissionBubble", $0) }
            }
        }
    }

    private func statusTitle(_ status: String) -> String {
        switch status {
        case "connected": return "已连接"
        case "partial": return "需修复"
        case "usage-only": return "用量支持"
        default: return "可连接"
        }
    }

    private func capability(_ title: String, active: Bool) -> some View {
        Text(title).font(.system(size: 8.5, weight: .medium))
            .foregroundStyle(active ? Color.primary.opacity(0.8) : Color.secondary.opacity(0.35))
            .padding(.horizontal, 5).padding(.vertical, 2)
            .background((active ? PanelTheme.accent.opacity(0.12) : Color.secondary.opacity(0.06)),
                        in: Capsule())
    }

    // MARK: 用量记录

    private var usageSection: some View {
        SectionCard(title: "用量记录") {
            VStack(alignment: .leading, spacing: 10) {
                SwitchRow(
                    title: "记录 token 用量",
                    detail: "读取本机 AI 编程工具日志。纯只读、不联网，所以默认开启。",
                    isOn: store.bool("recordUsage", default: true)
                ) { store.setSetting("recordUsage", $0) }

                SwitchRow(
                    title: "用用量影响桌宠行为",
                    detail: "累计用量让 Maclawd 逐渐变困。关掉后它仍会在长时间静默后入睡。",
                    isOn: store.bool("petEnergy", default: true),
                    enabled: store.bool("recordUsage", default: true)
                ) { store.setSetting("petEnergy", $0) }

                SwitchRow(
                    title: "启用 Claude Code 事件增强",
                    detail: "让 Maclawd 通过 Claude Code 的 Hooks 实时接收运行事件，对桌宠的实时动作和状态判断更加精准。"
                          + "会向 ~/.claude/settings.json 添加 hooks，不覆盖已有配置，也不处理权限。",
                    isOn: store.bool("hookEnhancement")
                ) { store.setSetting("hookEnhancement", $0) }

                SwitchRow(
                    title: "启用 WorkBuddy 事件增强",
                    detail: "让 Maclawd 通过 WorkBuddy 的 Hooks 实时接收运行事件，让桌宠动作和状态判断更加精准。"
                          + "会向 ~/.workbuddy-ai/settings.json 或 ~/.workbuddy/settings.json 添加 hooks，"
                          + "不覆盖已有配置，也不处理权限。启用后请新开一个 WorkBuddy 会话。",
                    isOn: store.bool("workBuddyHookEnhancement")
                ) { store.setSetting("workBuddyHookEnhancement", $0) }
            }
        }
    }

    // MARK: 订阅额度

    private var quotaSection: some View {
        SectionCard(title: "订阅额度") {
            VStack(alignment: .leading, spacing: 10) {
                SwitchRow(
                    title: "读取订阅额度",
                    detail: "Codex 通过官方 CLI 自动读取；Claude Code 通过状态行读取；"
                          + "WorkBuddy 会读取本机登录文件，并使用其中的 Token 查询计费服务。"
                          + "Token 只在内存中使用，不写入 Maclawd 数据或日志。"
                          + "Maclawd 会自动兼容 Claude HUD 并保持它原有的显示。",
                    isOn: store.bool("quotaTracking"),
                    enabled: !statuslineBusy
                ) { want in
                    statuslineBusy = true
                    store.setSetting("quotaTracking", want) { _ in
                        statuslineBusy = false
                        store.loadSettings()
                    }
                }

                if store.quota.statusline == .foreign {
                    customStatuslineNotice
                }
                if store.quota.statusline == .chained {
                    Text("已兼容 · 原有状态行继续正常显示")
                        .font(.system(size: 10.5))
                        .foregroundStyle(PanelTheme.accent)
                }
                // 这条盲区必须写在界面上，不能只写在文档里：
                // 用户看到一个 3 小时没动的数字，第一反应是「坏了」。
                Text("Claude Code 状态行只在交互式界面刷新。`claude -p`、CI 与后台任务同样消耗额度，"
                     + "但不会触发更新，因此数字可能滞后。")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var customStatuslineNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(store.bool("quotaTracking")
                 ? "Codex 额度已开启。自定义 Claude 状态行未被修改。"
                 : "检测到自定义 Claude 状态行，尚未修改它。")
                .font(.system(size: 10.5))
                .foregroundStyle(.orange)
            Button("保留原显示并读取额度") {
                statuslineBusy = true
                store.statuslineAction("chain") { _ in statuslineBusy = false }
            }
            .font(.system(size: 11))
            .disabled(statuslineBusy)
        }
    }

    // MARK: 提醒

    private var alertSection: some View {
        SectionCard(title: "额度提醒") {
            VStack(alignment: .leading, spacing: 10) {
                SwitchRow(
                    title: "快用完时提醒我",
                    detail: "同一个窗口周期内只提醒一次；窗口重置后下个周期重新计。",
                    isOn: store.bool("quotaAlert", default: true)
                ) { store.setSetting("quotaAlert", $0) }

                if store.bool("quotaAlert", default: true) {
                    ThresholdSlider(
                        value: store.number("quotaAlertThreshold", default: 85)
                    ) { store.setSetting("quotaAlertThreshold", $0) }

                    Button {
                        QuotaAlertHUD.showTest()
                    } label: {
                        Text("测试提醒").font(.system(size: 11))
                    }
                }
            }
        }
    }

    // MARK: 菜单栏

    private var menuBarSection: some View {
        SectionCard(title: "菜单栏显示") {
            Picker("", selection: Binding(
                get: { MenuBarController.Density.current.rawValue },
                set: { MenuBarController.Density.set($0) }
            )) {
                ForEach(MenuBarController.Density.allCases, id: \.rawValue) { option in
                    Text(option.title).tag(option.rawValue)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
        }
    }

    // MARK: Codex 宠物

    private var codexPetSection: some View {
        SectionCard(title: "Codex 宠物") {
            VStack(alignment: .leading, spacing: 8) {
                Text("把随应用附带、已经校验过的 Maclawd v2 动画包安装到 ~/.codex/pets/maclawd。不会联网，也不会读取其他宠物。")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    Button {
                        switch codexPetState {
                        case .installed:
                            openCodexSettings()
                        case .updateAvailable:
                            confirmingPetUpdate = true
                        case .ready:
                            installCodexPet(replacing: false)
                        case .blocked:
                            refreshCodexPetState()
                        }
                    } label: {
                        Text(codexPetButtonTitle).font(.system(size: 11))
                    }
                    .disabled(isCodexPetBlocked)

                    if codexPetState == .installed {
                        Button("打开 Codex 设置") { openCodexSettings() }
                            .font(.system(size: 11))
                    }
                }

                if let note = codexPetNote {
                    Text(note)
                        .font(.system(size: 10))
                        .foregroundStyle(isCodexPetBlocked ? .orange : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var codexPetButtonTitle: String {
        switch codexPetState {
        case .ready: return "一键安装到 Codex"
        case .installed: return "已安装"
        case .updateAvailable: return "更新 Codex 宠物"
        case .blocked: return "无法安装"
        }
    }

    private var isCodexPetBlocked: Bool {
        if case .blocked = codexPetState { return true }
        return false
    }

    private func refreshCodexPetState() {
        let installer = CodexPetInstaller()
        let package = CodexPetInstaller.bundledPackage(in: repoRoot)
        codexPetState = installer.state(packageAt: package)
        switch codexPetState {
        case .ready: codexPetNote = nil
        case .installed: codexPetNote = "已安装。若 Codex 尚未显示，请在 Settings > Pets 中刷新。"
        case .updateAvailable: codexPetNote = "Codex 中已有另一个 Maclawd 版本，更新前会再次确认。"
        case .blocked(let reason): codexPetNote = reason
        }
    }

    private func installCodexPet(replacing: Bool) {
        let installer = CodexPetInstaller()
        let package = CodexPetInstaller.bundledPackage(in: repoRoot)
        do {
            _ = try installer.install(packageAt: package, replacing: replacing)
            codexPetState = .installed
            codexPetNote = "安装完成。请在 Codex 的 Settings > Pets 中刷新并选择 Maclawd。"
        } catch CodexPetInstallerError.replacementRequired {
            confirmingPetUpdate = true
        } catch {
            codexPetState = .blocked(error.localizedDescription)
            codexPetNote = error.localizedDescription
        }
    }

    private func openCodexSettings() {
        guard let url = URL(string: "codex://settings") else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: 危险区

    private var dangerSection: some View {
        SectionCard(title: "数据") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Button {
                        rescanNote = "扫描中…"
                        store.rescan { rescanNote = "已完成" }
                    } label: { Text("重新扫描").font(.system(size: 11)) }

                    Button {
                        store.updatePrices { json in
                            rescanNote = (json?["count"] as? Int).map { "价格表 \($0) 个模型" }
                                ?? "更新失败"
                        }
                    } label: { Text("更新价格表").font(.system(size: 11)) }

                    if let note = rescanNote {
                        Text(note).font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                }

                Button {
                    onOpenBrowser("/usage")
                } label: {
                    Text("在浏览器里打开完整统计").font(.system(size: 11))
                }

                Divider().padding(.vertical, 2)

                if confirmingReset {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("删除全部用量记录？本机日志不受影响，重新扫描可以全量重建。")
                            .font(.system(size: 10.5)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button("确认删除") {
                                store.resetData { confirmingReset = false }
                            }
                            .font(.system(size: 11))
                            Button("取消") { confirmingReset = false }
                                .font(.system(size: 11))
                        }
                    }
                } else {
                    Button { confirmingReset = true } label: {
                        Text("删除全部用量记录").font(.system(size: 11)).foregroundStyle(.red)
                    }
                }

                Divider().padding(.vertical, 2)
                Button { onQuit() } label: {
                    Text("退出 Maclawd").font(.system(size: 11))
                }
            }
        }
    }
}

// MARK: - 组件

private struct SwitchRow: View {
    let title: String
    let detail: String
    let isOn: Bool
    var enabled: Bool = true
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12))
                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            Toggle("", isOn: Binding(get: { isOn }, set: onChange))
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .disabled(!enabled)
        }
    }
}

/// 阈值滑块。松手才写盘——拖动过程中每一帧都 POST 会把设置文件写烂。
private struct ThresholdSlider: View {
    @State private var draft: Double
    private let commit: (Double) -> Void

    init(value: Double, commit: @escaping (Double) -> Void) {
        _draft = State(initialValue: value)
        self.commit = commit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("用到").font(.system(size: 11)).foregroundStyle(.secondary)
                Text("\(Int(draft))%")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                Text("时提醒").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Slider(value: $draft, in: 50...95, step: 5) { editing in
                if !editing { commit(draft) }
            }
        }
    }
}
