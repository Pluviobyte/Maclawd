# 多来源用量对齐（2026-09-14）

范围：本地 Token、模型归属、缓存拆分、去重、刷新和实时窗口。服务端订阅额度不由本地 Token 推算。每批独立验证、提交、推送，保留已有其他工作区改动。

## 上游基线

- vibe-usage main `fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`，稳定版 `v0.10.21`。
- vibe-usage-app main `6feb8bcec3d034046d34f3709bd97f23190962c6`，稳定版 `v0.5.10`。
- OpenUsage main `bb055e26ee7ac65b982947cf6e3df6feda10dcca`（账户用量参考；本批不改账户凭据或额度）。
- openai/codex main `d77ebc72237a639b6d877f2edc3b20b54631f25e`，最新稳定 `rust-v0.154.0`。
- 重点近期变更：vibe-usage `84d007b7` Codex continuation、`ba8ebd36` Cline SDK、`51775e12` Hermes Desktop；缺乏真机日志的来源不能宣称已完成真机对账。
- 补充核对 npm 注册表：最新发布包实际是 `0.10.31`，gitHead 与上述 main 完全相同；`v0.10.21` 是 GitHub 最新标记 release，不是 npm 最新版。实际研究的 main 已覆盖 npm 最新代码。

## 第一批：实时窗口及概览新鲜度

先运行 `node --test test/usage-refresh.test.js`：两个测试失败，复现窗口内新增 99 Token 提前过期、来源活动无法提前刷新。

- Claude 持久化调用高水位，和窗口样本分离。每次仅将新增差额归入该次记录时间，重复记录不延长样本寿命，跨窗口及重启后也不重新计算整次调用。
- 任意来源日志新建、追加、轮转或重写可触发合并后的 5 秒刷新请求；连续活动不反复推迟刷新，重扫复用现有增量扫描，并维持单实例执行。
- 尾读本身也避免重叠轮询；停用采集时不强行打开主开关。
- 针对性测试 32 项通过（usage-refresh、scan、daemon-catchup）。实际全源文件库存：Claude 110、Codex 1405（约 11.7 GB）、WorkBuddy 6、Kimi 64、Qwen 1、Grok 84、Gemini 2、OpenClaw 1；数据库/hook 来源单独核对。

## 第二批：Codex 日期与实时基线

- 已读取官方 `codex-rs/protocol/src/protocol.rs` 的 TokenUsage、TokenUsageInfo、ThreadSettingsAppliedEvent，并与 vibe-usage 最新解析交叉验证。
- 先运行日期回归测试，复制快照被归到 9000 而不是原时间 1000；修正同快照优先原调用时间。
- 实时轮询保存解析器续读 state，不再每秒丢掉累计基线、模型与 ordinal；中途接入的首个 cumulative-only 快照只建基线，不把历史累计当成新增。支持 thread_settings_applied 模型更新。
- scan-cache v13、rollup v6 使历史模型归属修正生效。针对性 41 项通过。
- 对本机 1405 个 Codex 文件完成全量对照。部分跨日偏移已消除，但仍存在 fork/replay 边界差异；不能把本批称为 Codex 已完全对齐。上游有基于父会话索引的回放前缀匹配，本地仍主要依赖 payload 去重。continuation 分段也需要补齐；本机按文件名发现的同 ID 分段数量为 0，不能据此省掉兼容性测试。
- 其他真实来源初步总量对账：WorkBuddy 562,949、Kimi 192,896,619、Grok 153,391,949、OpenClaw 19,223，均与上游一致。Qwen 本地 ledger 为 64,041,144，而 vibe-usage 只扫旧 chats 路径得到 0，应保留本地现代 ledger 支持。

## 第三批：Antigravity SQLite

- vibe-usage 的新版时间恢复在 `556b1c57` 中引入。交叉核对 ccusage main `1b4f42314bf9fe2f323436d2dadba18ba9b04970` 的 ModelUsage、CodexBar main `69c5a785c2e7e76f49ed63445b3c277f63de38e4`（release v0.60.2）的 bot/step 时间关联。
- 本机 238 个有 usage 的 generation 均能唯一关联同一 step UUID 下的 bot ID，只有 71 个可通过同 idx 直接对应 UUID。采用身份关联而非数组位置/idx，歧义时上报来源不完整，不猜时间。
- 本机全部 238 条均满足字段 3 = 字段 9 + 字段 10；与 ccusage 的 total_output / reasoning / visible 解释一致。因此 output 使用字段 3，不像 vibe-usage 那样再加字段 9。CodexBar 的计数解释又不同，仅采用独立验证一致的时间身份关系，不复制其 token 字段语义。
- 同时保留缓存写字段 4。离线 SQLite 实测由 0 恢复为 238 条、15,018,741 Token，来源完整且无警告。
- vibe-usage 总路径先前返回 19,176,452，其代码还可覆盖本项目未开启的语言服务 RPC 路径；不同来源覆盖和输出重复计算不能混成目标值。本批对齐可验证的离线记录，不新增私有网络接口。
- 回归测试先失败（0 条 vs 1 条），修复后覆盖新版缺失时间、不同 idx、唯一 bot/step 身份、歧义拒绝、输出包含推理与缓存写入。

## 第四批：Pi/OMP 路径和 WorkBuddy 模型

- 核对 Pi 官方 `badlogic/pi-mono` main `ceea48f5d5d12fd7915dfefba2835ccd55f23bb9`、release `v0.85.1` 的 config.ts：agent 根与 sessions 根不同。对照 vibe-usage 的 pi-roots。
- Pi 扫 agent/sessions、环境变量独立会话目录及 settings.sessionDir（仅可确定的绝对路径），realpath 去重。OMP 扫 profiles、XDG 与继承的 agent 根；检测到 OMP store 时不再作为 Pi 重复统计。
- WorkBuddy 增加现代 `.workbuddy-ai/projects`，保留旧根；模型优先 requestModelId，而非 Auto/套餐展示名。先运行回归测试确认错误，再修复；保留已有非缓存输入/输出口径。

## 第五批：Codex 真实会话身份、重放和分段

- 先写回归测试并复现：独立会话相同快照被误合并（27 变为 10），分叉之后真实相同调用被误删（35 变为 25），续写累计值重复相加（38 变为 48）。
- 物理文件全部保留，按首个 session_meta.id 归组；精确跨文件副本以出现次数合并，保持单文件顺序。先合并再做累计差，保留计数重置与每段模型上下文。冲突时来源标记不完整并保留最后成功统计。
- 历史不再用全局 payload hash 去重。只在明确父子关系内匹配 spawn 时父日志的连续重放前缀，支持父会话后续增长、Last-N、复制尚未完成的子会话、明确 task 边界以及没有 task 的旧子会话。
- 缓存仅保留数值字段、模型、会话关系、时间与哈希，不保留聊天/工具正文；新增测试验证隐私边界。scan-cache v16 / rollup v9 强制旧缓存重建。暖缓存复用来源结果；新增、删除、重写、轮转审计均使来源结果失效。
- 真机完整读取 1,406 文件、约 11.7 GB。与上述最新 vibe-usage 对账：截至 9 月 13 日的 **158 个历史日期总量全部相同**；按半小时和基础模型归并后也没有差异。9 月 14 日仍在产生新日志，两次非同时扫描相差 1,382,850 Token，不能作为稳定快照差异。
- 口径换算：vibe-usage 的 output 不含 reasoning，Maclawd 的 output 包含 reasoning；比较使用上游 totalTokens + cachedInputTokens。上游 tier 后缀合并至基础模型后比对，本批尚不把 tier 作为独立费用维度。
- 范围边界：本批对齐 Token 计数，不声称实时短窗口的跨父子匹配、分段后的精确活跃时长或服务档位费用已经完全对齐。多段会话的时长暂取最完整摘要，不能将重叠摘要简单相加。

## 第六批：Cline 新旧存储及完整 JSON 扫描

- 核对 Cline 官方 main `19ddebb3b9de734a968db1a37867092ef5387774`，最新 release `desktop-v0.0.27`，及 vibe-usage `fcf1c398`。官方 `messages-contract-v1.md`、`services/session-data.ts`、`services/usage.ts` 与 `llms/src/providers/ai-sdk.ts` 交叉确认 SDK 输入已包含缓存读和写。
- 新增 `.cline/data/sessions`、CLINE_DIR / CLINE_DATA_DIR / CLINE_SESSION_DATA_DIR、编辑器扩展根和自定义根支持；校验 SDK v1 manifest/artifact 身份，只取带有效时间的 assistant metrics。缺少时间的迁移累计值不搬到迁移当天。
- SDK 缓存读写都从 inputTokens 中拆开，输出不重复相加。与上游相比额外保留官方 cacheWriteTokens 维度，避免把缓存写入按普通输入估价；不把日志 cost 当订阅限额。
- 旧版优先 `ui_messages.json` 每次调用的时间、模型和用量，同任务不再叠加 taskHistory 累计。缺少明细的旧安装保留任务摘要降级；这类摘要无法还原精确跨日分布，不能声称完全逐日对账。
- 依赖 manifest 的模型/项目变化也参与缓存失效；不支持的版本、损坏 JSON 保留旧结果并报告来源不完整。测试覆盖恢复副本、部分快照补全、嵌套数据根去重及不持久化正文。
- 真实回归测试还发现通用 `whole` 读取错误：没有结尾换行的完整 JSON 被截为 0 字节。现仅 JSONL 受换行边界约束，完整 JSON 按完整长度读取。scan-cache v17 / rollup v10。
- 本机没有可用 Cline 会话，本批为官方契约和本地夹具验证，不标记为真机已验证。

## 第七批：Roo Code 每次调用与模型语义

- 最新官方仓库 RooCodeInc/Roo-Code 已归档，核对最终 main `b867ec9145750d0ae1ff7f02d35406e9bf2a0b16` / release `v3.54.0`，不是沿用未经检查的旧结论。与 vibe-usage `fcf1c398` 交叉核对 TaskHistoryStore、taskMessages、HistoryItem。
- 支持 `_index.json` 的 `entries` 包裹结构，优先每个任务的 `ui_messages.json`，用调用时间而不是任务更新日期汇总。任务元数据优先于可能滞后的全局索引；明细缺失才保留摘要降级，不能叠加二者。
- 官方明确 `apiConfigName` 是用户配置名，不能像上游那样默认作为模型 ID。调用有 `model` 时优先它，否则缺乏真实模型信息就保留 unknown，避免错误估价。
- 损坏的消息文件保留旧缓存并公开不完整状态。scan-cache v18 / rollup v11；本机没有 Roo 日志，验证级别为官方契约＋端到端夹具。

## 最终复核与覆盖边界

第七批之后，再次离线扫描除 Claude/Codex 外的全部 24 个已注册来源，没有解析警告或未完成来源。没有文件/没有 usage 的 0 仅表示本机未发现可计数记录，不能作为语义正确的证据。

| 来源 | 本机 Token 总量 | 当前证据 |
| --- | ---: | --- |
| Claude | 见 Claude 专项审计 | 总量、日期、模型、项目、半小时分桶均已对账 |
| Codex | 17,715,439,143（扫描时快照） | 158 个稳定历史日期与半小时/基础模型分桶一致；当天持续增长 |
| WorkBuddy | 562,949 | 与上游相同，已修复路由模型 |
| Kimi | 192,896,619 | 与上游相同 |
| Grok | 153,391,949 | 与上游相同 |
| OpenClaw | 19,223 | 与上游相同 |
| Qwen | 64,041,144 | 保留本地现代 ledger；上游旧路径 0 不能当作目标 |
| Antigravity | 15,018,741 | 238 条 SQLite 记录字段/时间关联真机验证；与上游冲突按真实字段关系取舍 |
| Cursor | 2,416,880 | 3 条原始 stop 记录、2 个 generation、1 份完全重复；独立重算与扫描相同 |
| Gemini / Zcode | 0 | 有存储但没有可计数 usage，不能由 0 宣称字段已验证 |
| Pi / OMP / Cline / Roo | 无本机样本 | 已修复上述兼容性并通过夹具；仍标“待验证” |
| Copilot / Amp / Droid / Trae / OpenCode / Hermes / Kiro / MiMo / Alma / DimAgent / Craft Agent | 无本机样本 | 本轮未完成真机对账，不宣称所有模型/套餐分支均已对齐 |

Cursor 本轮还核对官方 Hooks common schema（generation_id 每条用户消息改变，model_id 是结构化模型 ID）；只读本地记录，未开启云端或请求账户凭据。对应最新官方文档：<https://prod.cursor.com/docs/hooks>。原始三条记录均满足缓存读写不超过输入，重复记录数值完全相同。

剩余明确事项（不包含在“已完成对齐”中）：

1. Trae CLI 的 Jaeger 风格 startTime 微秒、嵌套调用层及 reasoning 语义与上游存在差异。本机无样本；时间单位可由 Jaeger 规范交叉佐证，但供应商专有调用层/字段语义尚缺第二份独立证据，不盲改全部计数规则。
2. Kiro 最新上游增加本地估算路径；本项目是否要显示估算 Token，应与精确用量分开设计，不能把 credits、字符估算和真实 Token 混合。
3. Hermes 的会话累计、Cline/Roo 只有任务摘要时，不能重建跨日分布。
4. Codex 服务档位费用、所有来源实时窗口的跨会话身份以及精确会话活跃时长，尚未完成全部分支核对。本轮只对有证据的 Token 计数与来源兼容性作出结论。
5. 所有“服务端订阅额度百分比”独立于本地用量。本轮未修改现有工作区中账户额度、Cursor 凭据或面板的其他未提交工作。

本轮代码按批推送 main，未重新打包或重启当前运行应用。Antigravity 的 UI 验证标记已随真机证据更新；其他无样本来源不因测试通过而升级为“已验证”。

最终测试：当前工作区 `npm test` 714 项通过。另把待推送的 Git tree 导出到独立临时目录，不含面板/额度等既有未提交改动，重新执行完整测试 **698 项全部通过**。两者数量差来自工作区已有额外测试；远端版本的验证以隔离的 698 项为准。
