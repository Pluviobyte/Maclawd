# Vibe Usage 上游 Token 与费用口径核查（2026-09-16）

本记录是实施前 Maclawd 对齐审计的上游证据；后续完成情况见 [实施记录](token-cost-alignment-implementation-2026-09-16.md)。只读取公开源码、GitHub 元数据与合成测试夹具；未读取真实凭据、原始用户会话，也未调用使用用户身份的 Vibe/Cursor 接口。这里只描述实际已合并行为，未合并 PR 单独注明。

## 1. 本次联网核对的版本

| 仓库 | 最新默认分支 | 最新 GitHub 稳定 release | 取舍 |
| --- | --- | --- | --- |
| vibe-cafe/vibe-usage | `main`，`fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`，package 0.10.31 | `v0.10.21`，`8f8d88fd70612b3853363eb0bd2ff3ba6ae2ef79`，2026-09-03 | 以 HEAD 作为当前能力；npm `latest` 也返回 0.10.31 与同一 gitHead，GitHub release 页落后。 |
| vibe-cafe/vibe-usage-app | `main`，`6feb8bcec3d034046d34f3709bd97f23190962c6` | `v0.5.10`，`34d50754e0504b4a33b87d1f7927d462f30cb98e`，2026-09-03 | HEAD 比稳定版增加 Claude 额度恢复，不改变下文 Token/费用字段。 |

核对方式：GitHub repository/default branch、commits、releases/latest、tag ref、最近更新的 issues/PR，以及 npm 公共 registry。源码镜像在 `/tmp/maclawd-vibe-current/cli` 与 `/tmp/maclawd-vibe-current/app`；GitHub 元数据保存在同级 JSON，仅用于本次审计。

来源：[CLI HEAD](https://github.com/vibe-cafe/vibe-usage/commit/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5)、[CLI release](https://github.com/vibe-cafe/vibe-usage/releases/tag/v0.10.21)、[npm latest 元数据](https://registry.npmjs.org/@vibe-cafe%2fvibe-usage/latest)、[App HEAD](https://github.com/vibe-cafe/vibe-usage-app/commit/6feb8bcec3d034046d34f3709bd97f23190962c6)、[App release](https://github.com/vibe-cafe/vibe-usage-app/releases/tag/v0.5.10)。

## 2. 必须区分的三层数据

1. 本地 parser 把原始日志归一化成 Token 记录，再按 source/model/project/hostname/半小时归桶。
2. CLI 把桶上传 Vibe 服务端；CLI 和 Mac App 都从 `/api/usage` 读取服务端返回的 `estimatedCost`。
3. Mac App 另有订阅额度模块；其限流窗口、使用百分比不是前两步的 Token 计价输入。

当前公开仓库的成本目标是 Token 乘对应模型/服务档位公开价格的**估算值**，而不是用户银行卡实际扣款；订阅、赠金、API 付费身份不应改变同一批 Token 的 API 等价金额。源码说明与客户端链路支持这个区分，但服务端实际费率表和全部定价分支不能仅靠公开 CLI/App 验证。

来源：[成本口径说明](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/AGENTS.md#L128-L133)、[CLI 获取服务端结果](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/summary.js#L19-L23)、[CLI 汇总 estimatedCost](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/summary.js#L60-L67)、[App APIClient](https://github.com/vibe-cafe/vibe-usage-app/blob/6feb8bcec3d034046d34f3709bd97f23190962c6/VibeUsage/Services/APIClient.swift#L8-L38)。

## 3. Token 字段：总量可等价，列不能直接对齐

最新已合并 CLI 桶包含四个 Token 列：

| Vibe 字段 | 语义 |
| --- | --- |
| inputTokens | 普通输入，**还包含缓存写入**；不包含缓存读取。 |
| outputTokens | 非 reasoning 输出（原日志能拆分时）。 |
| cachedInputTokens | 缓存读取。 |
| reasoningOutputTokens | 独立 reasoning 输出；没有独立数据时为零，不能由文本推测。 |

`aggregateToBuckets().totalTokens = inputTokens + outputTokens + reasoningOutputTokens`，**没有加入缓存读取**。但 Mac App `UsageBucket.computedTotal` 使用四列之和，**包含缓存读取**。CLI `summary` 则直接读取服务端 `totalTokens`，不能把本地 aggregate 的这个字段值直接当成线上显示总量；服务端可能重新计算，公开客户端无法证明其当前实现。

因此，与 Maclawd 对比时应比较归一化后的总量，以及缓存/推理的包含关系，不能直接相减 `inputTokens` 或 `outputTokens`。若 Maclawd 的 output 已包含 reasoning，再加 reasoning 就会重复；Vibe 的 Codex/MiniMax output 列则通常不含 reasoning。

合成例子：普通输入 100、缓存写入 70、缓存读取 200、普通输出 10、reasoning 30。当前 Vibe 桶是 input=170/output=10/cacheRead=200/reasoning=30，本地 totalTokens=210，Mac App computedTotal=410。本次直接调用已核对 HEAD 的 aggregate 验证该结果。

来源：[四字段聚合与 totalTokens 公式](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/aggregate.js#L32-L80)、[Swift 字段与 computedTotal](https://github.com/vibe-cafe/vibe-usage-app/blob/6feb8bcec3d034046d34f3709bd97f23190962c6/VibeUsage/Models/UsageBucket.swift#L12-L27)。

## 4. 四个关键 parser 的实际口径

### Codex

- 优先使用 `last_token_usage`，缺失时才对 `total_token_usage` 做差；模型切换不重置会话级累计基线；累计字段下降时按计数器重置处理。
- OpenAI input 本身含缓存，Vibe 扣缓存读后写入 input；output 本身含 reasoning，Vibe 扣 reasoning 后写入 output，再把 reasoning 单列保留。
- 相邻事件正数累计 total 完全相同，后者作为重复 emission/零新增事件跳过。
- 同 ID continuation、archive/live 副本、fork/subagent 回放另有跨文件处理，不能只检查 parser 单行算式。
- 从 2026-08-31 起，会将日志的 `fast`/`priority`/`flex`/`batch` 档位编码为模型后缀。普通/default/null 不加；unknown 模型不加。来源为 `turn_context.service_tier` 或 `thread_settings_applied.thread_settings.service_tier`，合并 continuation 时保留分段上下文。开始日期用于避免旧远端桶身份变化后重复上传，不是价格政策日期。
- 未见按每次请求的上下文长度生成长上下文计价维度；`model_context_window` 不是长请求计价判断。原始模型名自带的字符串可能保留，但不能据此宣称已实现按请求输入长度分档。

来源：[档位后缀](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/codex.js#L31-L54)、[档位上下文与 Token 计算](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/codex.js#L678-L774)、[continuation 修复 #94](https://github.com/vibe-cafe/vibe-usage/pull/94)。

### Claude Code

- cache write 总量取 `max(cache_creation_input_tokens, 5m + 1h)`，避免总量与明细重叠；然后整体加到普通 input，**TTL 明细随之丢失**。
- requestId/message.id 识别同一次 API 调用，把多 content block/streaming 重复记录合并，保留 usageScore 最大的完整记录；旧格式退回 uuid。
- 不同数据根同一逻辑 session 优先读取更完整文件；会话项目固定到初始 cwd。
- 已合并 HEAD 不读取 Claude `usage.speed`，未对 fast 服务单独计价，也没有每请求上下文档位。

来源：[缓存写总量](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/claude-code.js#L60-L75)、[写入普通 input](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/claude-code.js#L224-L250)、[调用去重](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/claude-code.js#L297-L326)。

### MiniMax Code

- inputRaw + cacheWrite 写入普通 input；cacheRead 单列；原始 output 与 reasoning 独立保留，不从 output 再扣 reasoning。
- 只查询 Token、时间、模型、session/project 列，单条 SQLite JOIN 保持 Token 与项目来自同一快照。
- 空模型保持 unknown；不会根据“由 MiniMax 应用产生”擅自指定具体模型或价格。
- schema/读取失败返回 skipped，保护之前上传状态；只提供用量桶，不从 assistant 台账猜用户会话时长。

来源：[MiniMax parser](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/mcode.js#L13-L177)。

### Cursor

- 从账户级 CSV 导出取数；CSV 的 cache write + uncached input 合并普通 input，cache read 单列，output 原样计入，没有独立 reasoning。
- 不把 CSV 实际扣费/订阅身份当 API 等价计价输入；模型保留导出的 model。
- hostname 固定为 `cursor-cloud`，避免同一账户多机器重复上传；project=unknown。
- 当前导出超时为 120 秒，网络/429/5xx 软失败保留旧状态，过期登录可见报错。没有以“能发现应用”当做“本次取到了用量”。

来源：[Cursor 导出与错误处理](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cursor.js#L72-L180)、[CSV 映射](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cursor.js#L255-L300)。

### 采集源覆盖也并非完全相同

与当前 Maclawd `src/runtime/parsers/index.js` 及实际 parser 文件逐项比较：

| Vibe 当前能力 | Maclawd 当前状态 | 对总量比较的影响 |
| --- | --- | --- |
| `qoder`、`qoder-cn` 独立 parser | 未注册、未找到对应实现 | 用户使用 Qoder 时，两边采集集合不同；并非公式问题。 |
| `dsh`（DeepSeek Harness） | 未注册、未找到对应实现 | DSH 会话不在 Maclawd 当前解析范围。 |
| `cola` | 未注册、未找到对应实现 | Cola 的 Pi 格式存储与复制会话去重未接入。 |
| Cindy `daily_model_usage` 合并到 codex / pi-coding-agent | 未找到 Cindy ledger 实现 | 上游即使不显示名为 Cindy 的独立 source，也可能比只读原生 Codex/Pi 日志多统计一部分。 |
| 单一 `workbuddy` source | Maclawd 额外拆出 `workbuddy-ai` | 按应用行对照时先合并同一业务家族；不能要求来源名称完全一致。 |

Cindy 上游明确排除 Claude ledger，因为 Cindy 的 Claude SDK 已写入原生 Claude 日志；其他 harness 账本才合并。若未来接入，必须保留这条去重边界，不能简单遍历全部 `daily_model_usage` 再与原生日志叠加。

Cline 新 SDK `.messages.json` 及 modern `metrics` 在两边都已有实现，不能把它列成 Maclawd 完全缺失的源；但 Vibe 将写缓存留在 input，Maclawd 进一步分开，因此字段仍不能直接比较。

来源：[Vibe 注册表](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/index.js#L32-L64)、[Cindy merge 边界](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cindy-ledger.js#L57-L119)、[Cola](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cola.js)、[Cline modern SDK](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cline-sdk.js)、[Maclawd 注册表](../src/runtime/parsers/index.js)、[Maclawd Cline](../src/runtime/parsers/cline.js)。

## 5. 金额：无法宣称“与 Vibe 当前价格表完全相同”

可确认的内容：

- 两个公开仓库只采集/上传 Token 并读取 `estimatedCost`，没有完整模型费率表或本地计价器。定价源码指向服务端 `packages/model-pricing`。
- 本次公开访问 `vibe-cafe/vibe-cafe` GitHub repository API 返回 404；npm `@vibe-cafe/model-pricing` 公共 registry 也返回 404。结论限于**公开渠道无法核查完整引擎**，不能根据 404 推断内部不存在实现。
- 源码维护说明要求按模型/服务档位的供应商公开价格估算；但公开代码无法验证其当前每个模型的费率、价格抓取来源、自动抓取频率、失败降级、历史费率时点、长上下文或免费套餐的完整行为。
- 价格匹配是 source-agnostic 的模型字符串匹配。Qoder 曾使用裸 `auto` 错套 Cursor Auto 价格，已通过 `qoder-auto` 前缀修复；“命中了价格”不等于“命中了正确价格”。

来源：[模型定价匹配约定](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/AGENTS.md#L208)、[真实匹配冲突 #83](https://github.com/vibe-cafe/vibe-usage/pull/83)。

### 上游目前仍存在的费用信息损失

缓存写入并入 input 后，服务端仅凭已上传桶无法知道其中多少是普通输入、5 分钟缓存写、1 小时缓存写，也就无法精确重建各自费用。只要适用费率不同，总 Token 正确并不能保证金额正确。Maclawd 已有独立缓存写列时，不应为了逐字段一致而把该维度删掉。

2026-09-16 核查 [PR #101](https://github.com/vibe-cafe/vibe-usage/pull/101) 仍 open、merged=false。它计划为 Claude 新增 `cacheCreation5mTokens`/`cacheCreation1hTokens` 并根据 `usage.speed` 添加 `-fast`；配套服务端改动指向不可公开核查的 PR #215。PR 作者给出的历史偏差比例属于其样本，**不是本机 Maclawd 的误差率**。即使该 PR 合并，也明确只迁移 Claude；MiniMax/Cursor/Pi 等仍需分别研究缓存写费率与字段语义。

本次没有把该 PR 当作现有稳定版能力，也没有把 PR 中尚未独立验证的所有具体模型费率当作官方价格事实。

## 6. 增量、去重、扫描调度不能混成一个能力

- CLI 输出完整逻辑数据视图后，用桶和 session 内容 hash 做**增量上传**；成功批次才提交 hash，失败重试。30 分钟桶是上传身份，不是“只统计当前半小时”。
- Codex 另有版本化**增量解析缓存**：不变文件直接复用；普通安全追加验证 inode/device、换行、尾部 guard 后仅读追加字节。复杂 fork/continuation 需更完整的索引/合并。记录内容只保留统计元数据和临时指纹，不把原始对话存入缓存。
- Codex 冷扫描默认 105 秒预算；可逐文件 checkpoint 并返回 skipped，在下次继续；历史滚动审计最多读取一个受限大小文件/组。这里的 skipped 不表示用量为零。
- Mac App 默认 1800 秒调度 CLI 同步；CLI 软件默认解析 npm `@latest`。**每 30 分钟同步数据、CLI 自动更新**都不能证明服务端每 30 分钟同步官方价格。

来源：[增量上传](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/sync.js#L279-L324)、[成功后提交](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/sync.js#L397-L421)、[Codex 安全尾读](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/codex.js#L180-L207)、[扫描预算](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/codex.js#L492-L516)、[App 调度](https://github.com/vibe-cafe/vibe-usage-app/blob/6feb8bcec3d034046d34f3709bd97f23190962c6/VibeUsage/Models/AppState.swift#L481)、[CLI 软件版本选择](https://github.com/vibe-cafe/vibe-usage-app/blob/6feb8bcec3d034046d34f3709bd97f23190962c6/VibeUsage/Services/RuntimeDetector.swift#L5)。

## 7. 近期修复/已知问题与对齐建议

| 上游条目 | 本次状态 | 对齐含义 |
| --- | --- | --- |
| [#94 同 ID continuation](https://github.com/vibe-cafe/vibe-usage/pull/94) | 已合并，`84d007b7c9c6`，稳定 GitHub release 之后 | 应专门验证同 ID 多片段包含重叠历史和各自新增用量；按 session 选最大单文件会漏统计。 |
| [#89 Cursor 导出超时](https://github.com/vibe-cafe/vibe-usage/pull/89) | 已合并，默认 120s | 判断“是否对齐”包含软失败/旧数据保护，不只是 CSV 字段。 |
| [#101 Claude TTL/Fast](https://github.com/vibe-cafe/vibe-usage/pull/101) | 未合并 | 不应把已知低估方案当对齐目标；单独保留缓存写和服务档位更合理。 |
| [#97 kimi-for-coding 定价](https://github.com/vibe-cafe/vibe-usage/issues/97) | open | 真实 model ID 与营销展示名不同；未证实价格时保留未定价，不能错套近似模型。 |
| [#103 dropped-source sessions](https://github.com/vibe-cafe/vibe-usage/pull/103) | 未合并 | 当前 buckets 跳过未知来源 hash，但 sessions 仍提交；这是云上传一致性缺口，不直接适用于 Maclawd 本地统计。 |

本次独立运行：

```text
node --test test/aggregate.test.js test/claude-code.test.js test/codex.test.js test/mcode.test.js test/cursor.test.js
tests 83, pass 83, fail 0, skipped 0
```

日志 `/tmp/maclawd-vibe-current/upstream-tests.log`。这些测试都使用合成文件/数据库与 mock 网络；通过只证明核对的 parser 合约在其测试中成立，不证明服务端价格正确，也不证明 Maclawd 与它所有边界完全一致。

最终判断应分四项：Token 总量是否等价、重复/遗漏边界是否等价、定价维度是否完整、实际费率是否可验证。不能用单一“已参考 Vibe”或“价格覆盖率”替代这四项。
