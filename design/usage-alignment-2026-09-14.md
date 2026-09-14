# 多来源用量对齐（2026-09-14）

范围：本地 Token、模型归属、缓存拆分、去重、刷新和实时窗口。服务端订阅额度不由本地 Token 推算。每批独立验证、提交、推送，保留已有其他工作区改动。

## 上游基线

- vibe-usage main `fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`，稳定版 `v0.10.21`。
- vibe-usage-app main `6feb8bcec3d034046d34f3709bd97f23190962c6`，稳定版 `v0.5.10`。
- OpenUsage main `bb055e26ee7ac65b982947cf6e3df6feda10dcca`（账户用量参考；本批不改账户凭据或额度）。
- openai/codex main `d77ebc72237a639b6d877f2edc3b20b54631f25e`，最新稳定 `rust-v0.154.0`。
- 重点近期变更：vibe-usage `84d007b7` Codex continuation、`ba8ebd36` Cline SDK、`51775e12` Hermes Desktop；缺乏真机日志的来源不能宣称已完成真机对账。

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
