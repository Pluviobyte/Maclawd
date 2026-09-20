# vibe-usage 更新对照审计（2026-09-20）

## 结论

需要跟进，但不能把上游所有行为原样移植。优先修复 **Grok 1.0 漏读、Droid 输入少计与模型映射、Cursor 云端格式变化被当作空数据、Kimi 桌面日志发现**。新增 CodeBuddy、CodeArts Agent、Devin 属于覆盖范围扩展。Claude 的缓存 TTL / Fast 计费、已支持工具自动发现、Cline 格式异常保护已有对应实现，不需要重做。

本轮是研究与验证：以 Maclawd `09b5c80184065f2c72ffa5d71c72c6ef7a1b1711` 加现有工作区改动为比较对象，没有修改业务代码，没有 commit 或 push。保留当前 ZCode 删除、Cursor 额度和面板顺序等未提交改动。Token / API 等价费用与服务端订阅额度分别比较。

## 核对版本与证据范围

| 项目 | 本轮基准 | 说明 |
| --- | --- | --- |
| vibe-usage CLI | [`b4a38745785a243ea23f5130285d78624f89a9f5`](https://github.com/vibe-cafe/vibe-usage/commit/b4a38745785a243ea23f5130285d78624f89a9f5) | 9 月 20 日 main；npm `0.12.0` 的 gitHead 与之相同。GitHub latest stable release 仍为 `v0.10.21`（9 月 3 日），不能据此认定近期没有更新。 |
| 上次 CLI 基线 | [`fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`](https://github.com/vibe-cafe/vibe-usage/commit/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5) | 本次差异范围是此提交至新 main；部分现在合并的 PR 上次已经提前评估/实现。 |
| Grok 官方源码 | [`4247f661689354b831191f11eeeac8424993fe3d`](https://github.com/xai-org/grok-build/tree/4247f661689354b831191f11eeeac8424993fe3d) | 核验账本字段、时间、完整性与 total 语义。 |
| Droid 独立解析参考 | [`tokenleak@fd38fa290d7cd4e317b95401f42a4aa2f3779808`](https://github.com/ya-nsh/tokenleak/blob/fd38fa290d7cd4e317b95401f42a4aa2f3779808/packages/registry/src/providers/droid.ts) | 仅交叉核验 sidecar input 与 cache 分开读取；其 reasoning 处理与 Vibe 有冲突，不照搬。 |

实时 GitHub API 与 git fetch 校验了默认分支、latest release、近期 merged PR / issues；CLI 本轮查询时没有 open PR。npm 版本依据 [registry latest 元数据](https://registry.npmjs.org/@vibe-cafe%2fvibe-usage/latest)。App、官方 Codex/Kimi、OpenUsage 的版本和取舍见后文。

## 应跟进的本地统计修复

### P1：Grok 1.0 用量账本漏读

- 上游最新提交增加 `<session>/usage.json`，兼容旧 `updates.jsonl`，并在会话有已完成轮次但读不到用量时给出警告。[上游实现](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/parsers/grok.js)
- Maclawd `src/runtime/parsers/grok.js:37` 只发现 `updates.jsonl`，`onObject` 只接受带 `update.usage` 的 `turn_completed`，不读账本。隔离样例中，同一个新格式会话：Maclawd **0 条记录**，最新 Vibe **1 个 bucket，150 个总吞吐 Token（含缓存读）**。
- 建议：兼容新旧账本，选择单一权威记录避免双计；账本及 summary 纳入缓存签名；有完成轮次却无用量时显示不完整状态并保留上次数据。
- **不能原样搬 Vibe 的时间与缓存写算法**：官方 `TurnUsage` 已有 `endedAt`，`UsageSummary` 有 `modelUsage`、`usageIsIncomplete`，官方 `total_tokens()` 是 input + output。Vibe 却按 `turn_completed` 顺序配时间、缺失时取 summary，并额外把 `cacheCreationTokens` 加到 input。实现应优先采用官方字段，确认缓存写包含关系，防止错日或重复加 Token。官方还说明 session totals 可能包含 resume/fork 继承历史，不能把整份 session totals 无条件当新增消耗。[官方账本结构](https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-shell/src/session/usage_file.rs)、[官方计数语义](https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-chat-state/src/usage.rs)、[官方 sessions / grok usage 文档](https://github.com/xai-org/grok-build/blob/4247f661689354b831191f11eeeac8424993fe3d/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md)

### P1：Droid 输入被再次扣缓存，custom 槽位未解析为 API 模型

- 上游 [PR #105](https://github.com/vibe-cafe/vibe-usage/pull/105) 修复 sidecar 的 `inputTokens` 已是非缓存输入却又减缓存的问题；模型通过 `customModels[].id → model` 映射。Vibe 有真机响应对照，独立 tokenleak 实现同样直接读取 input、单列 cacheRead/cacheCreation。Factory 官方也明确 `model` 是发给 API 的标识，`id` 是配置项标识。[Factory BYOK](https://docs.factory.ai/model-independence/byok)、[官方配置项说明](https://docs.factory.ai/enterprise/hierarchical-settings-and-org-control)
- Maclawd `src/runtime/parsers/droid.js:70` 仍做 `rawInput - cacheRead - cacheWrite`；`:82` 原样保留槽位字符串。
- 隔离样例 input=1048、cacheRead=10752、output=11：本地 input=**0**，上游=**1048**；配置槽位可映射到 `gpt-5.4`，本地仍为 `custom:display-name-[gw]-0`。这是输入少计和定价失败的两条独立原因。
- 建议：修正 input，按明确配置映射模型，保留无法确定的模型；不要把任意显示名猜成模型。旁挂 settings 与模型目录的变化也须参与缓存失效，目前 discover 只返回 JSONL 的 mtime/size，单独更新 settings 时可能继续复用旧记录。
- 现有 output 已包含 reasoning 的合同应保留，不能再额外相加。tokenleak 在这一点与 Vibe 不一致；本次只用它验证 input/cache 拆分。缓存写 TTL 未知的处理应沿用 Maclawd 数据合同，实施时再按真实样例验证。

### P1：Cursor 云端 CSV 格式变化会静默变空

- 上游最新代码要求 Date、Model 和至少一个已知 Token 列；不满足时 `skipped` 并报 warning，保护历史状态。[上游格式检查](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/parsers/cursor.js)
- 本地 `src/runtime/parsers/cursor.js:270` 的 `parseCursorUsageCsv()` 遇到未知 Token 列时返回 `[]`，没有错误；`fetchRecords()` 把它当正常结果。隔离的“Date、Model 保留，Token 列全部改名”样例已复现空数组。
- 建议：区分合法空表与不支持的 schema，抛出可展示的格式错误，使 `scan.js:600` 已有保留旧缓存路径生效。保留我们已有的列名别名支持，不要为追随上游而缩小兼容范围。
- 影响仅限用户启用 Cursor 云端历史扫描的路径；默认本地 hook 路径不是此次缺口。这里也不涉及正在修改的 Cursor 订阅额度逻辑。

### P1：Kimi Work 桌面内置运行时没有进入本地统计扫描

- 上游 [#85 对应实现](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/kimi-roots.js) 新增 macOS 根：`~/Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/kimi-code/home`，与 CLI 根同时扫描，realpath 去重；各根自己的 `session_index.jsonl` 提供项目归属。
- Maclawd `src/runtime/parsers/kimi-code.js:20` 只有现代 CLI 和旧 `.kimi` 两个根；目录解析对照已确认缺少桌面根。已能显示 Kimi 订阅额度不等于能统计其桌面 Token。
- 建议：增加桌面根，并把 CLI / desktop 来源归属传到现有工具发现和统计筛选；同一物理文件避免重复读取，保持用户禁用偏好。仅添加数据根无需发起新网络请求。
- 此路径依据当前上游实现与其桌面测试，本轮没有读取本机 Kimi 会话或将本机桌面数据作真机验收；实施时补现代/旧版/桌面并存、symlink 去重、覆盖路径、项目归属与 UI 顺序测试。

### P2：新增三种工具，按覆盖范围扩展

| 新来源 | 上游存储/关键处理 | Maclawd 当前状态 |
| --- | --- | --- |
| CodeBuddy Code CLI | `$CODEBUDDY_CONFIG_DIR/projects` / `~/.codebuddy/projects`；请求模型兜底；消息 ID 为空时用 providerMessageId / 自身 ID，不能用 turn ID 折叠多次调用。 | 注册表没有 `codebuddy`；已有国内/海外 WorkBuddy 不能自动等同为 CodeBuddy CLI。 |
| CodeArts Agent | `~/.codeartsdoer/codearts-data/opencode.db`；WAL、父子 session、多 profile 去重、只查询计量白名单字段。 | 注册表没有 `codearts-agent`；不能因数据库派生自 OpenCode 就混成同一产品。 |
| Devin CLI / Desktop | `$XDG_DATA_HOME/devin/cli/sessions.db`；按 session + message 去重，真实用户提示与 keepalive 分离。 | 注册表没有 `devin`。 |

来源：[CodeBuddy](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/parsers/codebuddy.js)、[CodeArts](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/parsers/codearts-agent.js)、[Devin](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/parsers/devin.js)。三者本轮只确认公开实现与本地缺项，未对本机安装状态和真实日志验收。接入时应复用现有自动发现链路；没有官方额度接口的工具，只进入 Token 统计筛选，不伪造订阅额度卡片。Vibe 的部分新解析器仍把 cache write 折进普通 input，Maclawd 必须转换成自己的互斥计数与定价合同。

## 已覆盖、可选兼容和不应照搬

- **Claude 缓存 TTL / Fast**：上游 #101 已合并；Maclawd 已有 `write5m/write1h`、缺失拆分余量处理、`usage.speed` 与逐请求计费层级，相关本地测试通过。Vibe 另接受 `message.speed` 作为防御性兜底，本地未接受；这只是可选兼容，不能据此说现有 Fast 计费整体缺失。[上游 Claude](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/parsers/claude-code.js)
- **Cline 版本/格式防护**：本地 `cline.js:79,100` 已检查 manifest/artifact，扫描失败保留历史数据；不需要重复做同类功能。单个损坏 manifest 在 discover 阶段会令整来源回退，未来可以细化错误范围，但没有 Cursor 那种“当正常空数据”的结论。
- **工具自动发现**：`tool-discovery.js` 已把已安装解析器加入统计筛选，额度提供方单独发现；本轮相关三项回归通过。新工具问题在于还没有适配器/路径，不能笼统归结为“缺自动发现功能”。
- **Vibe 云端同步修复**：账号切换时重传、被丢弃来源保留 sessions 状态是 Vibe 云上传架构的问题；Maclawd 本地统计没有对应上传账户状态，不需要复制其 state/account 绑定流程。
- **Kimi 价格不能为了数字一致而改回旧估算**：[issue #97 的维护者结论](https://github.com/vibe-cafe/vibe-usage/issues/97) 是保留 K2.5 时期估算，原因包括看板/榜单连续性，并非发布了 K2.8 官方 Token 单价。本轮官方页面确认 `kimi-for-coding` 对应 K2.8 Preview，而开放平台价格说明仍未列该模型独立单价。我们保留未知价格标识，不套相邻型号，不把订阅额度倍率直接当美元单价。[Kimi 官方模型说明](https://www.kimi.com/code/docs/en/kimi-code/models.html)、[官方 API 定价](https://platform.kimi.com/docs/pricing/chat)
- **ZCode**：上游增加 GLM/ZCode quota 不构成恢复本地已删除解析器的依据；本轮尊重现有删除改动，若将来接入 GLM 额度，应作为明确产品范围单独评估。

## 本地统计验证记录

1. 最新 Vibe CLI：`node --test test/grok.test.js test/droid.test.js test/kimi-code-desktop.test.js test/cursor.test.js test/cline-sdk.test.js test/codebuddy.test.js test/codearts-agent.test.js test/devin.test.js` → **73/73 通过**。
2. Maclawd 当前工作区：`node --test test/parsers.test.js test/parsers-ported.test.js test/cline-alignment.test.js test/cursor-local.test.js test/billing-context.test.js test/kimi-code-integration.test.js test/tool-discovery.test.js` → **61/61 通过**。
3. 单独合成样例比较 Grok 新账本、Droid 缓存与模型目录、Cursor 未知表头、Kimi 根解析，成功复现以上差异。脚本和输出分别在 `/tmp/maclawd-vibe-sep20/reproduce.mjs`、`reproduction-results.json`；这些是临时审计材料，不是已加入仓库的回归测试。

没有读取/输出真实凭据或会话正文，没有调用收费生成接口，没有上传真实用量。测试通过只说明当前覆盖项未退化，不表示缺项已修复；App 验证与其工具链限制见后文。

建议后续拆成可验收的部分：① Grok 账本和格式保护；② Droid 口径、模型和旁挂缓存；③ Cursor CSV 保护；④ Kimi 桌面与额度兼容；⑤ 三个新增解析器；⑥ 原生进程超时等稳定性。每部分若进入实施，再独立测试和提交。

---


## macOS App 补充审计：范围与结论

本轮只读核查，以 `vibe-usage-app` 上次默认分支 `6feb8bcec3d034046d34f3709bd97f23190962c6` / stable `v0.5.10` 为基线，不重复全量旧审计。Maclawd 对照点是 HEAD `09b5c80184065f2c72ffa5d71c72c6ef7a1b1711` 加当前已有工作树改动；没有修改、回退或提交业务代码。下文 Maclawd 行号是本次工作树行号，后续修改可能移动。

**App 上游确有更新，最新稳定版为 v0.6.2；最值得参考的是可辨识的空状态、子进程防死锁/超时、认证上下文隔离与诊断契约。** 不应把新的产品列表和卡片布局直接搬入 Maclawd：Maclawd 已支持 Cursor、更多地区来源和独立的后台额度提醒；Vibe 当前 Cursor 仍只识别、没有额度适配器。Kimi 主动刷新值得研究，但 Vibe 与官方进程使用不同刷新锁，不能照搬后宣称无竞争。

本报告只使用公开仓库、文档、release/issue metadata 和人工夹具；没有调用私人账户接口、读取凭据、读取原始用户会话或扫描本机产品安装清单。报告不包含私人账户、真实用量、私人目录或密钥。

## App：本次实际核对的版本

| 项目 | 核对结果 |
|---|---|
| 最新默认分支 | `main`：[`bc38182571728d48b394b0883ecca846f6ba860c`](https://github.com/vibe-cafe/vibe-usage-app/commit/bc38182571728d48b394b0883ecca846f6ba860c)，2026-09-19 亚洲/上海时间合入 PR #43 |
| 最新 stable | [`v0.6.2`](https://github.com/vibe-cafe/vibe-usage-app/releases/tag/v0.6.2)：`5bbe63353395427f56d4260dcc439afddcdd0d1d`，2026-09-18T04:23:45Z 发布 |
| 前两版 | [`v0.6.1`](https://github.com/vibe-cafe/vibe-usage-app/releases/tag/v0.6.1)：`bb4732a04a2c5e1a2727f492a832bc9435d3fec1`；[`v0.6.0`](https://github.com/vibe-cafe/vibe-usage-app/releases/tag/v0.6.0)：`3afbe26f175a1dab168c13705268b93b82306f01` |
| 上次 stable | `v0.5.10`：`34d50754e0504b4a33b87d1f7927d462f30cb98e`；上次默认分支已包含 Claude 环境覆盖修复 #40 |
| main 与 stable 差异 | v0.6.2→main 仅 `docs/RELEASING.md`、`scripts/generate-appcast.sh`、新增 `scripts/rewrite-appcast-enclosures.py`；额度/App 运行逻辑相同 |

版本来源为实时 `git ls-remote`、fetch 后 commit/tag 和 GitHub REST release/PR/issue API。网页搜索缓存仍可能显示 v0.5.10，不能用旧页面片段否认新发布。对比按 Git 可达性做，不按 commit 作者日期筛选：PR #42 的部分提交创作于9月7–12日，但9月17日才进入默认分支，属于本轮新增。

供应商交叉验证同时核对到的最新stable metadata：Codex [`rust-v0.155.1`](https://github.com/openai/codex/releases/tag/rust-v0.155.1)（9月18日）、OpenUsage [`v0.7.12`](https://github.com/robinebers/openusage/releases/tag/v0.7.12)（9月17日）、Python Kimi CLI [`1.50.0`](https://github.com/MoonshotAI/kimi-cli/releases/tag/1.50.0)（9月1日）、TypeScript Kimi Code [`2.0.2`](https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai/kimi-code%402.0.2)（9月19日）。供应商字段判断固定到下文实际读取的最新main commit，不声称已完整验证这些产品的stable安装包。

## App：新合并行为与 Maclawd 适用性

### A1. 多产品选择与无数据状态：保留已有能力，只补真实缺口

PR [#42](https://github.com/vibe-cafe/vibe-usage-app/pull/42)，最终 merge `9b8e60421d1b4d0385a6cc0d05f003490c6b5c6b`，新增产品 catalog、持久选择、Kimi Code/ZCode/Grok 的 CLI 额度桥接。初次选择只推荐检测到且有适配器的产品；用户明确保存空选择后不会重新自动填满。之后 `eb6de5f` 移除“两项”上限，每个启用产品始终有独立卡片，横向滚动显示；空状态区分未读到、没有窗口、明确用满、未检测安装/登录。

当前源码为准：PR #42 的原描述仍写“固定CLI版本、零/一/两个产品、保持Draft”，这些已被合并后的改动替代，不能当最终行为。现在正式版使用 `@latest`、不限两项；Cursor 为 `pendingProtocol`，即使选择也不读取凭据或启动查询。

证据：[QuotaProduct.swift L65–72、160–246](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Models/QuotaProduct.swift#L65)、[RateLimitCardView.swift L26–59、134–149](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Views/RateLimitCardView.swift#L26)、[QuotaCLIBridge.swift L147–155](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/QuotaCLIBridge.swift#L147)。

Maclawd `src/runtime/tool-discovery.js:1–27` 已独立于首次请求成功发现支持的额度来源，并给无窗口来源生成 pending/loading/needs-login/error/disabled 状态；`mac/Sources/Maclawd/PanelView.swift:695–765` 对可见来源逐项显示，没有两项上限。工作树的 `PanelModel.swift:126`、`PanelView.swift:494–692` 已有显示选择与排序，应保留。**不需要为“对齐”重新做两卡横滚，不应将已经工作的 Cursor 降级为待接入，也不恢复正在移除的 ZCode。** 更细的“无生效窗口”状态可以参考，但必须有供应商字段证明，不能把空列表理解成额度用完。

### A2. 额度查询的开关/调度不同：不把“隐藏卡片”改成“停止采集”

上游额度独立于 Vibe 云端账户绑定，即使未绑定也可选择/读取额度；取消云登录后折叠登录状态。额度查询只针对已选产品，打开 popover 时每产品60秒节流；Codex、Claude、CLI三路并行；相同CLI查询共用 flight，新增未覆盖产品待前一次完成后补查；取消/旧 generation 结果不写回；关闭面板取消进行中的额度查询，**没有后台额度轮询 timer**。这些新扩展沿用原Codex/Claude的按需查询方式。

证据：[AppState.swift L281–297、444–465](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Models/AppState.swift#L281)、[RateLimitCoordinator.swift L291–446、474–537](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/RateLimitCoordinator.swift#L291)、[MenuBarController.swift L279–298](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/MenuBarController.swift#L279)。本轮 `SyncScheduler.swift` / `DirectoryWatcher.swift` 无改动；不要把新的额度 fan-out 说成日志扫描调度被重做。

Maclawd `PanelModel.swift:972–986` 面板打开每5秒轮询**本地HTTP快照**，关闭即停止；供应商采集另在 runtime：`provider-quota-collector.js:18–28、57–68` 有单flight、间隔缓存、generation和abort，`codex-quota.js:295–357` 有同类保护，`claude-quota.js:183–224` 还有错误退避。`PanelView.swift:504` 明确显示隐藏不能停采集或额度提醒。因此上游“未选=不查询、关面板=取消查询”的产品语义不宜直接移植；可复用并发合并和迟到结果保护的原则，保留后台提醒需求。

### A3. CLI 输出死锁和超时：Maclawd 有一处同类风险

`2e9df4c` / merge `c64f914` 新增 `CLIProcessRunner`。旧实现先 `waitUntilExit()` 再排空stdout/stderr Pipe，大输出可让子进程堵在写Pipe，父进程又等待退出。新实现把两路输出分别写入权限受限临时目录内的文件，进程结束再读，离开时清理；在后台队列执行；120秒同步期限与取消使用TERM→1秒后KILL；`timedOut` 优先成为明确超时错误，正常Bun stderr不等于失败；非零退出时保留两路诊断，避免只显示安装器进度。

证据：[CLIProcessRunner.swift L3–7、45–70、88–140](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/CLIProcessRunner.swift#L3)、[SyncEngine.swift L45–82](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/SyncEngine.swift#L45)、[CLIProcessRunnerTests.swift](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/Tests/VibeUsageTests/CLIProcessRunnerTests.swift)。这是临时文件方案，不是并发排空Pipe；源码只直接杀所持有child，不宜扩写成“保证回收所有后代”。

**适用项：**Maclawd `mac/Sources/Maclawd/RuntimeClient.swift:177–189` 寻找Node的最后login-shell回退同样先wait再读Pipe，而且没有deadline。若shell启动脚本输出超Pipe容量或挂住，回退可卡住。该点是静态确认的同类控制流风险，没有执行用户shell配置去复现。正式包优先自身Node（同文件153–175），主runtime输出已经落文件（252–269），Claude/Codex探针也实时消费stdout并有限时，所以不能把整个Maclawd运行时说成都有该死锁。

建议后续独立修复这个小范围回退：有限时、可取消、不会等待未排空Pipe；用人工大输出/不退出脚本验证，不读取或改动用户shell配置。无需改成联网 `npx @latest` 启动本地产品。

### A4. 新版本CLI边界：协议版本值得参考，`@latest`不适合直接套用

正式App始终调用 `@vibe-cafe/vibe-usage@latest`；新增 `quota fetch --product … --json` schemaVersion=1，30秒bridge timeout，按产品映射 ok/no_data/unauthorized/retryable_error。unsupported schema / unknown product 显式错误，不假装空额度。构建脚本用发布CLI做命令/协议检查；外测包可绑定本地tgz并强制npx package mode，附独立构建身份。

证据：[RuntimeDetector.swift L4–22、39–60](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/RuntimeDetector.swift#L4)、[QuotaCLIBridge.swift L3–40、45–68、108–143](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/QuotaCLIBridge.swift#L3)、[check-cli.mjs](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/scripts/check-cli.mjs)。

Maclawd绑定随包runtime及build身份，`RuntimeClient.swift:153–175、252–264、310–345`，不依赖每次联网解析npm才能启动。建议保留可复现分发；可参考“打包时验证实际runtime协议/身份”，不能把Vibe仓库的 `@latest` 政策当成Maclawd的强制要求。

### A5. Codex明确null、空窗口与耗尽：官方证实结构，但不证明所有原因推断

上游 `CodexUsageAPI.swift:231–300` 新区分 `rate_limit:null` 与缺失rate_limit：明确null作为成功无窗口，缺字段或错误类型作为不可解析；两窗口都空时，优先 `limit_reached`、否则 `!allowed` 显示已用满，其他显示没有窗口。不能仅因JSONL没有窗口显示“用满”。

本次联网检查官方 `openai/codex` main **`5c5308fc9a9ee789049d646ef11e5400384b9c6f`**：[`rate_limit_status_payload.rs L19–25`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs#L19) 的double option保留缺失/null/对象；[`rate_limit_status_details.rs L15–34`](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_details.rs#L15) 确实有 `allowed`、`limit_reached` 和可空primary/secondary。**null只证实没有该对象，不自动证实整个账户没有任何额度**：同payload还允许additional_rate_limits、credits、spend_control、rate_limit_reached_type。

独立核对 OpenUsage main **`519431b1345d9d6e2bffc7c12362eb4431a72e9b`**：[`CodexUsageMapper.swift L31–47、122–175、179–202`](https://github.com/robinebers/openusage/blob/519431b1345d9d6e2bffc7c12362eb4431a72e9b/Sources/OpenUsage/Providers/Codex/CodexUsageMapper.swift#L31) 允许可空rate_limit、按窗口时长分类、另解析additional限额；没有把null统一转成100%耗尽。因此Vibe空状态文案有可借鉴部分，但官方并未证明 `allowed=false` 单独就一定等于“周期额度耗尽”；实现应优先明确limitReached/reachedType，否则使用中性不可用描述。

Maclawd当前 `src/runtime/codex-quota.js:57–83、170` 使用官方 `account/rateLimits/read` 和 `rateLimitsByLimitId`，不是相同的私有REST形状。上游这次改动不要求Maclawd改回直读OAuth/私有API；未来可在官方协议给出足够字段时扩展空状态，不能移植未经该接口确认的JSON字段。

### A6. Kimi、ZCode认证：参考隔离，但保留产品与地区边界

App新增 Kimi Code 凭据自动发现/刷新由共享CLI负责；ZCode是用户主动输入的BigModel/Z.ai Key，分别保存在App自己的Keychain account。只有请求ZCode的子进程才得到对应地区环境变量，另一区域变量显式清理；换Key、删Key、换地区会清缓存/节流和取消相关flight，返回时再检查请求发起时的credential context，迟到结果不能覆盖新账户。Grok与Kimi-only查询不触碰ZCode Keychain。

证据：[QuotaCLIBridge.swift L71–87](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/QuotaCLIBridge.swift#L71)、[ZCodeAPIKeyStore.swift L4–39、58–83](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/ZCodeAPIKeyStore.swift#L4)、[RateLimitCoordinator.swift L336–410、520–537](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/RateLimitCoordinator.swift#L336)。这是App自管Key场景，不是“读取任意工具凭据都安全”的通用实现。Maclawd正在移除ZCode，本轮不因此恢复该产品；“身份变化使缓存失效”的设计可用于已有多地区适配。

**Kimi本地已确认差距：**`src/runtime/kimi-quota.js:103–133` 支持现代/legacy根、config引用和地区origin校验，但没有官方 `KIMI_SHARE_DIR`；138–145仅在认证失败后重读凭据，不主动刷新，也不根据expires_at提前处理。新Vibe CLI `b4a38745785a243ea23f5130285d78624f89a9f5` 的 [`kimi-code.js L137–172、339–390、394–465`](https://github.com/vibe-cafe/vibe-usage/blob/b4a38745785a243ea23f5130285d78624f89a9f5/src/quotas/providers/kimi-code.js#L137) 补了share override、提前刷新、401后refresh、原子轮换。自定义share目录或官方CLI未运行且token过期时，两边可有不同结果。

官方主证据是 **MoonshotAI/kimi-cli**（Python旧路径实现）main **`86f136422a0aae6b217ea49e7ea1d2e8a1defcd2`**：[`share.py L7–14`](https://github.com/MoonshotAI/kimi-cli/blob/86f136422a0aae6b217ea49e7ea1d2e8a1defcd2/src/kimi_cli/share.py#L7) 明确KIMI_SHARE_DIR；[`auth/oauth.py L50–66、264–309、503–546`](https://github.com/MoonshotAI/kimi-cli/blob/86f136422a0aae6b217ea49e7ea1d2e8a1defcd2/src/kimi_cli/auth/oauth.py#L50) 确认expires_at秒、刷新阈值、OAuth refresh流程、跨进程锁。现代 **MoonshotAI/kimi-code**（TypeScript）本轮最新main为 **`99eaa993bad28e2074fcf29f8b76c0ccf0f02b65`**；两个repo不是同一存储根，不能为了兼容Python CLI删掉Maclawd现代路径。

**不能照搬的竞态：**官方Python使用 `credentials/<key>.lock` + Unix `flock`；Vibe使用 `<credentials-json>.vibe-usage-refresh-lock` 的mkdir锁，两者不互斥。Vibe刷新前后重新读文件可减轻竞争，但无法证明与官方CLI并行rotation安全。最稳妥顺序是优先官方刷新能力；若独立实现，必须明确兼容锁协议/身份、刷新失败不覆盖旧token、地区限制和原子写回，不能只复制Vibe锁名。该结论来自公开代码，不曾触发真实token刷新。

### A7. macOS定位、提示与发布：多数无需直接移植

- `5e5fe8c`：自绘popover从status bar **按钮bounds**转换到屏幕坐标，再按所在屏幕visibleFrame钳制，避免用共享menu-bar window.frame时锚到屏幕左边。[MenuBarController.swift L359–392](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Services/MenuBarController.swift#L359)。Maclawd `PanelController.swift:88–121` 已使用NSPopover相对anchor.bounds显示，并检查屏幕有效性，有桌宠fallback；没有相同定位缺口。
- `48b72bd` / v0.6.2：额度tooltip通过SwiftUI preference上送到popover根overlay，测量后上下翻转、钳制边缘，避开横/竖ScrollView裁切。[PopoverView.swift L31–47](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Views/PopoverView.swift#L31)、[RateLimitCardView.swift L583–690](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Views/RateLimitCardView.swift#L583)。Maclawd `PanelView.swift:893–955` 将额度细节直接排在行内，InfoDot用系统popover（1016–1040），没有该自绘hover tooltip，可作为以后新增悬浮明细的参考，不需要引入新浮层。
- `3afbe26`：build脚本改成macOS系统Bash3.2可用；新的外测variant隔离bundle identity、嵌入准确CLI版本、编译typed脱敏诊断。Maclawd可参考诊断边界和产物身份，但本轮没有发现相同Bash语法故障。
- `3218c20`：六个工具使用官方标准图标的1x/2x资源。这是视觉变化，不是Token/额度改进；没有复制图标或推定其品牌资产许可。
- PR [#43](https://github.com/vibe-cafe/vibe-usage-app/pull/43)，`9f34a6b` / merge `bc38182`：appcast enclosure从GitHub `latest` URL改为各tag不可变ZIP URL，避免新版本切换后旧item签名配上新ZIP。生成后还修复历史item；缺版本则失败，不静默发布。**main有该修复，v0.6.2 tag未包含**，且代码合入本身不证明线上appcast已经重新生成。Maclawd当前 `mac/Package.swift`、`mac/Sources`、scripts/CI中未发现Sparkle/appcast链路，故本轮不适用；若将来接入自动更新，应采用不可变产物URL。证据：[generate-appcast.sh](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/scripts/generate-appcast.sh)、[rewrite-appcast-enclosures.py L52–99](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/scripts/rewrite-appcast-enclosures.py#L52)。

### A8. 可导出脱敏诊断：可借鉴，不能直接导出原始runtime日志

`034891d`、`e0ddbad` 新增只在Debug/显式external-test编译的typed诊断。字段限定事件、provider ID、status、meter数量、error code、App/CLI版本与commit、OS版本；接口不接受原始stderr、response body、路径、账户身份或token，1MB轮换。证据：[TestDiagnosticLog.swift L1–30、93–109](https://github.com/vibe-cafe/vibe-usage-app/blob/bc38182571728d48b394b0883ecca846f6ba860c/VibeUsage/Utils/TestDiagnosticLog.swift#L1)。

Maclawd `provider-quota-collector.js:35–46` 已限制错误消息，不让原始Error/headers/stdout进入 `/api/quota`；`RuntimeClient.swift:196–202、252–286` 另有原始运行日志。本轮未发现等价的typed诊断导出。可以补“版本/采集状态/错误码”的小型诊断报告，但不要把现有runtime.log直接当安全导出包，也不需要收集真实usage数值或安装清单。

## App：未解决问题与验证边界

实时GitHub open issues仅2项：

| Issue | 2026-09-20状态 | 本轮判断 |
|---|---|---|
| [#41 Desktop sync reports failure during Bun dependency resolution although manual sync succeeds](https://github.com/vibe-cafe/vibe-usage-app/issues/41) | open，最后更新2026-09-12 | v0.6.0已合并输出/超时修复并在发布说明列出，但issue仍open；可说“已有对应代码修复”，不能说提报者已验证关闭 |
| [#39 无法获取Claude code订阅](https://github.com/vibe-cafe/vibe-usage-app/issues/39) | open | 提报内容主要是截图，不足以确定所有根因。#40环境覆盖修复已在上次main基线内，本轮v0.6.0只是把它带入stable，不应当作新的字段变化 |

本轮未把closed-but-unmerged PR #38（旧Grok方案）当作已发布方案；当前以#42后的源码为准。旧搜索缓存中的#19/#22/#23/#26/#27不是本次实时open清单。

验证结果：

- 上游 `scripts/check-cli.test.mjs`：4/4通过（mock命令/协议，不运行用户CLI登录）。
- `/bin/bash -n` 检查 `build-app.sh`、`generate-appcast.sh` 通过；没有执行签名、公证、安装或发布。
- 独立编译实际 `CLIProcessRunner.swift`，用5个人工场景验证双路大输出、忽略TERM后的deadline、后代持有输出、非零退出两路输出、任务取消：5/5通过。仅合成shell，不加载用户profile。
- appcast脚本人工XML验证：历史URL重写且保留签名字段、幂等、缺版本失败且不写原文件均通过；没有用签名私钥或声称真实线上更新已验证。
- 尝试运行8组上游Swift测试，但当前工具链在测试编译阶段报 `no such module 'Testing'`。**没有完整Swift测试通过的结论**；以上独立runner验证不替代全部UI/coordinator套件。
- 没有实际多显示器UI验收、真实账户请求、真实OAuth轮换、Keychain验收或线上Sparkle升级。所有适用性判断是公开源码、人工夹具与Maclawd现有实现的对照。

