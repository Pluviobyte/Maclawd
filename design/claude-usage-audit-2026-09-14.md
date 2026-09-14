# Claude 本地 Token 统计诊断（2026-09-14）

本次只诊断，未修改运行时代码。按 diagnosing-bugs 的可复现验证要求，读取本机日志，分别执行 Maclawd 当前去重与调用级去重，再直接运行上游解析器交叉验证；不输出消息正文或凭据。

## 上游证据

- vibe-cafe/vibe-usage main：`fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`；最新稳定版 `v0.10.21`（2026-09-03）。两者均已使用调用级去重。
- 修复 commit：`d4f9a1d90fc62efbe1cb8d76f057b4648c145371`（2026-08-17），关联 PR #63。按 `message.id + requestId` 合并；两者均不存在才退回 UUID；同键保留 usage 总和最大的一条，不能把流式部分记录相加。
- ccusage/ccusage main：`1b4f42314bf9fe2f323436d2dadba18ba9b04970`；最新 release `v20.0.20`（2026-08-15）。最新 Rust Claude daily 聚合也有 message/request 级去重。Issue #888 提醒仅保留首次记录可能低估，#994 记录 session 路径未去重导致约两倍高估。不能只照搬 first-seen 策略。
- 官方字段定义：https://platform.claude.com/docs/en/build-with-claude/prompt-caching 。input_tokens、cache_creation_input_tokens、cache_read_input_tokens 是输入的不同部分。

## 本机复现结果

读取 110 个 JSONL 文件，131,105,716 字节；解析出 12,146 条 assistant usage，JSON 解析错误 0。最新事件为 2026-09-14T09:01:26.761Z。候选选择按当前扫描器的 session ID、大小、mtime 规则；先全局去重，再按 Asia/Shanghai 日期过滤。以下全部使用包含缓存读取的同一口径，不代表服务端额度。

| 起始日期（至采样时） | 当前 UUID 去重 | 调用级去重 / 上游实际运行 |
| --- | ---: | ---: |
| 2026-09-14 | 778,972,023 | 201,655,007 |
| 2026-09-08 | 1,590,918,529 | 468,733,573 |
| 2026-08-16 | 2,090,842,460 | 678,109,913 |
| 全部日志 | 2,808,979,651 | 985,977,118 |

当前 UUID 去重后剩 11,453 条，调用级去重后 4,203 条。存在 3,323 个包含多条记录的调用组，其中 2,521 组各条 input/output/cacheRead/cacheWrite 完全一致。直接运行上游 `parse()` 后，将 inputTokens + outputTokens + cachedInputTokens 求和，四个窗口与调用级重算逐个精确相等；上游无扫描警告。

## 结论与范围

1. `src/runtime/dedupe.js` Claude 特判错误：认为不同 UUID 是独立 usage 分片，导致同次调用重复累计。今天高估约 3.86 倍（多计约 5.77 亿）。`test/dedupe.test.js` 也把错误行为写成了预期，需要一起修正。
2. 当前运行进程来自仓库 `mac/Maclawd.app`；其打包资源 dedupe.js 同样含 UUID 特判。这里报告的是同批原始日志的重算，不宣称已核对面板每个缓存值。
3. Maclawd `throughput` 包含缓存读取；vibe-usage 聚合输出的 `totalTokens` 排除缓存读取（另设 cachedInputTokens）。今天上游此字段是 3,712,673，而包含缓存读取是 201,655,007。数值不能直接混比；缓存读取多本身不是统计错误。
4. 当前字段拆分与官方输入口径一致，cache_creation 的总计与 5m/1h 明细没有简单重复相加。已证实的主要问题在去重，不是把缓存读取计入总量这件事本身。
5. 本次不验证 Claude 服务端订阅百分比，也不将本地 Token 推算成额度。费用估算不能当订阅实付；本次未量化费用差异。

修复应采用调用身份 + 最大完整 usage，覆盖不同 UUID、部分/最终响应、跨文件副本、缺失 ID 和不同请求测试，并重建历史聚合以消除已累积的错误数据。保留现有所有用户改动，不在本次诊断中清缓存或重启。

## 后续修复（同日，用户授权全部修复）

- 再次联网确认 main 与 release 未变化；Claude 历史扫描与实时速率共用调用身份，保留最大完整 usage。其他供应商规则保持不变。
- 聚合版本升为 v5，避免旧的重复计数聚合继续展示；原始解析缓存保留逐行记录，每轮都会重新去重，无需删除日志或清除账户数据。
- 修正去重合同、CLI 中误导性的 billable 标签，为面板总 Token 添加包含缓存读取的口径说明。
- 先运行回归测试，4 项失败；修复后针对性 37 项通过，全量 694 项通过。
- 修复后实际 `scanAll` 与上游 `parse()` 在同批本机日志上均为 988,980,951 Token、4,213 条调用记录，扫描警告 0。相较初始诊断日志仍有新增，不能把两个不同采样时刻直接比较。
- 本机 arm64 release 打包成功。未提交或推送 Git；保留工作区原有改动。

## 深入复核（推送 add00fc 后）

本节仅复核和记录，未继续修改运行时代码。

### 历史统计与部署确认

- 再次联网确认 vibe-usage main 仍为 `fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`，稳定版仍为 `v0.10.21`；相关 PR #63 已关闭。
- 实际扫描得到 4,216 条记录，逐维度比较输入（合并缓存写）、输出、缓存读取：39 个日期、8 个模型、14 个项目、88 个日期/模型/项目组合及 237 个半小时/模型/项目组合，全部零差异。
- 缓存复用 110 个文件；比较每个记录字段、日聚合与整个 buildRollup 结果均一致。直接 JSON.stringify(records) 的字符串顺序可能因对象键插入顺序不同而不同，不代表字段值差异。
- 包内 parser/dedupe/tail/rollup 文件与源码一致，运行服务 `/api/ping` 的 buildId 与包内 runtime-build.json 精确匹配。应用复用了此前已启动的正确版本服务，并非仍使用修复前的解析器。
- 服务聚合版本 v5，Claude 110/110 文件完成，deferred=0、failed=0。

### 已定位的展示滞后

服务 `/api/status` 报告最近扫描时间 2026-09-14T09:18:06.081Z；Claude 已收录记录截止 09:15:43.810Z。服务当时总量为 989,303,747，最新本地重算为 989,958,143，差 654,396。

将修复后的真实扫描结果按同一截止时间过滤，恰为 989,303,747；截止之后新增两次调用的总量恰为 654,396。这次差异是刷新延迟，不是已扫描记录漏算。daemon 默认每 30 分钟扫描历史聚合，实时尾读每秒一次；两者没有自动把每次新 usage 合入历史聚合。可由 hook/手动重扫提前触发，但未触发时存在滞后。

### 实时窗口仍有边界缺陷

使用真实 Claude createFileParser 和 createTailer、临时 JSONL 与固定时钟复现，windowMs=60,000（缩短生产五分钟窗口以验证同一逻辑）：

1. t=0，同调用 usage 为 input=100、cacheRead=1000、output=1，窗口总量 1101。
2. t=55s，最终记录 output=100，窗口总量更新为 1200。
3. t=61s，没有新记录，窗口总量却变成 0。55 秒新增的 99 个输出 Token 尚在窗口内，却随首次样本一起过期。

原因位于 src/runtime/tail.js 的 prior 替换分支：更新计数与记录但保留首次采样时间，整条调用只有一个过期时刻。这不影响历史累计，但会让跨窗口调用的实时速率提前下降。后续修复应明确实时窗口采用增量时间归属，且调用去重状态与时间窗口样本寿命分开，避免重复记录续命或重新计入整个历史调用。

### 纠正对上游 UI 口径的解读

新核对 vibe-usage-app main `6feb8bcec3d034046d34f3709bd97f23190962c6`（最新稳定 release `v0.5.10`）。Models/UsageBucket.swift 的 computedTotal 会加 cachedInputTokens，Views/SummaryCardsView.swift 的总量卡片使用 computedTotal，而不是原始 totalTokens。

因此原先“原始 totalTokens 字段不含缓存读取”仍成立，但不能据此认为上游 App 总量不含缓存读取。其 App 总量与 Maclawd throughput 的展示口径一致。不要把这一内部字段差别当作 App 数字偏差的解释。

本次结论限于 Claude 本地 Token 统计、实时窗口和面板数据刷新，不代表 Claude 服务端额度百分比或费用估算也已完成逐项对账。
