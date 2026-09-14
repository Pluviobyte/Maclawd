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
