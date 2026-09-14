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
