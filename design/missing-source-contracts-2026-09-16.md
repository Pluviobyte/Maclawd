# 缺失来源的最小采集契约（2026-09-16）

本报告仅研究，不修改业务代码。目标是让 Maclawd 独立实现 Qoder / Qoder CN、DeepSeek Harness（DSH）、Cola、Cindy 日账本和 Trae CLI，并区分“可由官方确认”“两个独立实现一致”“只有 Vibe 的观察”。数据来源是产品官方源码/文档、公开 registry、最新 Vibe 源码和测试；没有读取用户凭据、原始对话或工具正文。

## 1. 本次联网核对的版本与许可证

| 上游 | 默认分支与实际核对 commit | 稳定发布 / 产品版本 | 许可证与使用边界 |
|---|---|---|---|
| [vibe-cafe/vibe-usage](https://github.com/vibe-cafe/vibe-usage) | `main` `fcf1c3981890cf31267b1ee1adf88d61a75fdbb5` | GitHub stable `v0.10.21`：`8f8d88fd70612b3853363eb0bd2ff3ba6ae2ef79`；npm latest `0.10.31` gitHead 为当前 main | README/package 声明 MIT，仓库未见 LICENSE 文件，GitHub license 为 null；仅作为协议事实和测试行为参考，独立重写 |
| [vibe-cafe/vibe-usage-app](https://github.com/vibe-cafe/vibe-usage-app) | `main` `6feb8bcec3d034046d34f3709bd97f23190962c6` | stable `v0.5.10`：`34d50754e0504b4a33b87d1f7927d462f30cb98e` | 本次新增格式主要在 CLI，app 未提供另一套独立解析证据 |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | **master** `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` | 没有非 prerelease stable；npm `@deepseek-ai/dsh` latest `0.1.5-rc.1` / tag `dsh-v0.1.5-rc.1`：`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`；next `0.1.5-rc.2`、alpha `0.1.6-alpha.1` | MIT；实际选择官方 main 的协议，并检查 npm latest 同为 format 3、attempt 统计逻辑一致 |
| [makecindy/cindy](https://github.com/makecindy/cindy) | `main` `40f087c99c849e93af97363d0e874531e97781fc` | stable `v0.1.82`：`1d7aaa2fb4456c1ba96ab7f2125567d7c19bbf69`（2026-09-15） | Apache-2.0；stable→main 的所查账本、地区路径、Codex writer 契约不变（schema diff 仅新增另一张通知表） |
| [camtrik/agent-trail](https://github.com/camtrik/agent-trail) | `main` `6e53f21f292955974ac21a082edb4ac216e2ad92` | latest stable `v0.1.7` | 本次树/metadata 未找到明确代码许可证；只交叉验证 Qoder 字段，不复制实现 |
| [earendil-works/pi](https://github.com/earendil-works/pi)（原 badlogic/pi-mono，官方跳转） | `main` `60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759` | stable `v0.85.1`；旧 `@mariozechner/pi-ai` npm dist-tag `0.73.1` 不是此仓库最新 release | MIT；用于证明 Pi 公共 usage 语义，不能单凭 Pi 证明所有 Cola 私有磁盘行为 |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | `main` `e4755ef6abb53a83316076f0e9e53f5f08c1f844` | stable/npm `0.23.4`，npm gitHead `fdcd7c2761e4ae18d578cf1413ae8d43f58b3e2c` | Apache-2.0 |
| [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code) | `main` `f4e5822164800ec138f77b0f323e2374963bfe19` | stable/npm `0.43.1`（annotated tag object `a3c66ba1b019c37e4069c5611266669d0438eb62`，不是 peeled commit） | MIT；动态 alias 以官方产品文档为准 |
| Qoder / Cola / Trae CLI | 未找到可核验的完整公开产品源码 | Qoder 官方 npm `@qoder-ai/qodercli` latest `1.1.53`，beta `1.1.54-beta.1`；Cola 官方 changelog `1.4.4`（2026-09-08）；Trae CLI 未找到可靠 stable tag | 未发现公开源码许可；按公开字段独立兼容。`bytedance/trae-agent` 是另一产品/日志格式，不冒充 Trae CLI 官方协议证据 |

核对方式：`git ls-remote`、浅克隆、GitHub release/commit metadata、公开 npm registry、官方文档；未安装执行这些第三方应用。GitHub 匿名 API 在后半程限流，改用公开 Git/raw 和文档，未读取任何登录 token。另刷新 OpenUsage main `56378e5765f85d38ff413036fd984afe3d4664e4`、CodexBar main `b75d765b69abf7b71afc02ad28ad7f8b37057c7b`，但它们的额度模块不是本报告新增本地日志格式的依据。

本次核对的相关近期修复：Vibe [Qoder 接入 #82](https://github.com/vibe-cafe/vibe-usage/pull/82)、[Qoder auto 定价串源 #83](https://github.com/vibe-cafe/vibe-usage/pull/83)、[Trae CLI 重复计数/时间修复 #65](https://github.com/vibe-cafe/vibe-usage/pull/65)，Cola commit `850f27dcf1db511b8c48a7ec93a27f77d1b35437`，以及尚未解决的 [kimi-for-coding 计价 #97](https://github.com/vibe-cafe/vibe-usage/issues/97)。这些是行为证据，不代表所有已知问题均被穷尽。

## 2. 本机可验证范围

本次环境未取得新增来源的真实用量样本，故采用公开上游和合成夹具验证，继续保留“待真机验证”。应用已安装或数据目录存在不构成字段正确性证据。

运行上游五组人工夹具：`node --test test/qoder.test.js test/dsh.test.js test/cola.test.js test/cindy.test.js test/trae-cli.test.js`，69 tests / 69 pass / 0 fail / 0 skipped。日志 `/tmp/maclawd-source-contracts/fixture-tests.log`。这是源码可执行一致性验证，**不是上述产品的本机真实响应验证**。

## 3. 公共边界

- Token 总量和 API 等价估值、供应商账单、订阅限额是三种不同口径。credits、quota multiplier、成本币种都不能反推 Token。
- Maclawd 目标口径：input 为未命中缓存输入；cacheRead / cacheWrite 独立；output 包含 reasoning；reasoning 仅为 output 子集。不把 reasoning 再加一次，不把含缓存 prompt 再加 cache。
- 字段缺失与已报告 0 区分；未知模型、未知缓存 TTL、缺逐请求上下文长度不能通过应用名或当天总量猜测价格。
- 所有 JSONL 仅读 allowlist 的 ID、时间、路径 metadata、模型、usage；不保留 message.content / stream 文本 / tool arguments。SQLite 显式列名查询，不用 `SELECT *`，不碰凭据或加密对话列。
- 源不存在可以空结果；文件被拒读、锁冲突、schema 不兼容、部分扫描失败必须保留 last-good 并报告 incomplete，不用空结果覆盖旧统计。完整数据更新采用替换快照，不累计已累计的日账本。
- 原生与嵌套 harness、复制日志、地区版本先判断来源所有权；不能按模型名或相同 token 数跨账户去重。精确 ID 优先，路径 canonicalize 仅解决同一文件的重复发现。

## 4. Qoder / Qoder CN

### 发现与输入格式

两个独立来源 ID：`qoder`、`qoder-cn`，同时安装时全部发现，保留地区身份。

| 类型 | 默认 / override |
|---|---|
| CLI 全球 | `~/.qoder/projects/**/*.jsonl`；`QODER_CONFIG_DIR` 改根后追加 `projects` |
| CLI 国内 | `~/.qoder-cn/projects/**/*.jsonl`；`QODERCN_CONFIG_DIR` 改根后追加 `projects` |
| macOS IDE | `~/Library/Application Support/{Qoder,QoderCN}/SharedClientCache/cache/db/local.db` |
| Windows IDE | `%APPDATA%/{Qoder,QoderCN}/SharedClientCache/cache/db/local.db` |
| Linux IDE | `${XDG_CONFIG_HOME:-~/.config}/{Qoder,QoderCN}/SharedClientCache/cache/db/local.db` |
| IDE override | `QODER_HOME` / `QODER_CN_HOME` 在 Vibe 指向 SharedClientCache 等价根，追加 `cache/db/local.db`；该 override 语义只有 Vibe 证据 |

官方 [CLI settings](https://docs.qoder.com/cli/settings)、[settings reference](https://docs.qoder.com/cli/settings-reference)、[installation](https://docs.qoder.com/cli/installation) 确認全球 CLI 根/override/npm 包。国内独立根与 IDE 表结构由 [Vibe qoder-roots.js](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/qoder-roots.js) 及第二独立实现交叉核对，未找到官方 SQL schema。

IDE 只需要 `chat_message`：`id,session_id,request_id,role,token_info,model_info,gmt_create`。可选 `chat_session` join 仅提取 `project_uri,project_name,preferred_model_info`；缺 session 表不应丢掉有效 usage。`token_info` 为 JSON，必看非负数 `prompt_tokens,completion_tokens,cached_tokens`；`max_input_tokens` 是容量，不是当次输入。

数学契约：`cached=min(prompt,cached_tokens)`；`input=prompt-cached`；`output=completion_tokens`；`cacheRead=cached`；write/reasoning 未提供。独立的 [agent-trail qoder.ts L402–423](https://github.com/camtrik/agent-trail/blob/6e53f21f292955974ac21a082edb4ac216e2ad92/ingest/parser/qoder.ts#L402-L423) 明确 `total=prompt+completion`、不能再加 cached，支持 cache 为 prompt 子集。模型优先 `model_info.model_key` / `modelKey`，再已知 session 模型 metadata；路由名 `auto,ultimate,performance,efficient,lite` 使用 `qoder-*` 命名空间，不能误命中 Cursor Auto。内部 qmodel ID 没有独立映射证据时保持未定价。

`gmt_create` 当前独立实现按 epoch 毫秒处理；Vibe 兼容秒/毫秒/数字字符串/ISO。Maclawd 可采用明确范围的兼容解析，但不得用错误单位造出未来日期。SQL identity 使用 `(region, canonical-db, chat_message.id)`；`session_id` 只做分组，`request_id` 可作为重复更新辅助，不足以替代唯一 row ID。

CLI 为 Claude 形状 JSONL：`type=user/assistant`、`timestamp`、`sessionId/cwd`、`message.id/role/model/usage`；递归包括 session 的 subagents。当前 Vibe 观察有 tokens 全 0 / credits 非零的 CLI 行，此时只记录活动，不把积分换成 Token。真正存在 Anthropic token 字段时按各桶独立提取。跨内容块仅对相同 `(region,sessionId,message.id||uuid)` 合并 usage，保留最完整一次；不按相同正文或 token 数去重。

### 缓存与降级

IDE 是 SQLite 快照：签名至少覆盖 DB/WAL 的变化；只看 DB mtime 会漏活跃写入。一致快照查询、按 id 替换，不能每次扫描再加一次全库。CLI 完整行可尾读；截断、inode/rewrite、模型 metadata 变化要重建相应文件/会话。错误 JSON usage 不得被解释为有效 0；没有旧数据时记录 unknown/incomplete。有 SQL schema 漂移时显式失败保护。

参考：[Vibe parser](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/qoder.js)、[agent-trail parser](https://github.com/camtrik/agent-trail/blob/6e53f21f292955974ac21a082edb4ac216e2ad92/ingest/parser/qoder.ts)。agent-trail 为自身会话浏览产品读取正文，Maclawd 不复制那部分行为。Qoder 当前 npm 1.1.53 比 Vibe 注释中实际验证的 CLI 1.1.42 新，需保留“无本机实样”的状态。

## 5. DSH（DeepSeek Harness）

### 版本、文件与继承

默认 `$DSH_HOME/sessions/<project-key>/<session-id>/session[.vN].jsonl[.zstd]`，DSH_HOME 默认 `~/.dsh`。官方 [types.ts L88](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/core/session/src/types.ts#L88) 当前 format=3；[filename.ts](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/session/session-format/src/filename.ts) 定义规范文件名。每个会话只选最高 generation，不能把迁移前后文件相加；同版本的压缩/原文按明确优先级选一个。较高版本损坏或不支持时不能静默退回旧版本，避免展示看似完整的旧数。

第一行 header：`type=session,version,id,cwd,createdAt,parentSession?`。v0/v1 用 `seedLength`；v2/v3 必须有 `isSeeded`，取最后 `session/end-seed` 且 `data.inherited=true` 的 `seq` 为继承边界（exclusive）；flag 与 marker 矛盾时拒绝。支持范围0–3，filename/header 版本应一致。event `time` 为 epoch 毫秒，Vibe 兼容 ISO。

fork/subagent 继承只在父会话存在且能证明逐项相同时剔除：同版本需 seq/role/model/usage 一致；跨 migration seq 会变，必须用保留下来的 message ID 和顺序比对。父缺失或前缀分歧时不删唯一副本，显示可能继承的质量信息。完整 attempt 实现应把继承边界应用于事件生命周期，而不只 assistant message 行。

Zstandard 文件可能由**每次 append 的多个完整 frame**串接。只解第一个 frame 会漏后续用量；需遍历全部 frame，尾部未写完 frame 可留待下次，损坏的完整 frame 应报错。上游设压缩256 MiB/解码512 MiB上限，可采用自己的资源上限。generation/父版本变化重建相关 group；最小可靠实现对压缩文件全量流式读取，不能假装普通字节尾读。

### 官方 Token 口径

官方 [TokenUsage](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/llm/llm/src/types.ts#L154-L176)：`inputTokens` 未命中缓存，`outputTokens` 包含 reasoning，`cacheReadTokens/cacheWriteTokens` 独立；`totalTokens` 可提供精确总数。reasoning 不能超过 output。DeepSeek adapter 会从完整 prompt 中扣除 cache hit 后填 input。缓存写无 TTL 时保留未知 TTL，不擅自套 Anthropic 5m/1h。

**重要：Vibe 当前仅解析 `assistant/message`，不等于 DSH 官方所有已收费 attempt。** 官方 main 与 npm latest 都有 [token-meter/turn-usage.ts](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/llm/token-meter/src/turn-usage.ts#L178-L281)，还计算重试、失败、取消但已有 usage 的 attempt。应按官方生命周期独立实现，不能只追求与 Vibe 的不足一致。

| 持久化事件 | 允许读取的字段 | 对统计的意义 |
|---|---|---|
| `turn/start` | `data.turn` | 开一轮，轮内单次出现 |
| `step/start` | `data.turn, data.step` | 从 idle 开一个 attempt |
| `assistant/attempt` | `data.turn,step,stream` 中的 usage chunk | 无 surface message 的 attempt 结束；取最后 usage 一次，状态置 finishClosed |
| `assistant/message` | `data.turn,step,usage,stream` 及 `message.id,source.provider,source.model` | 优先 data.usage，否则末个 stream usage；结算一次，标记 settled-by-message |
| `llm/retry` | `data.turn,step,retryId,provider,retry` | 开 retry 等待；已 finishClosed 不重复记；open 必须有可结算 sample |
| `llm/retry-started` | `data.turn,step,retryId,retry` | 仅 settled-by-retry 可开下一 attempt |
| `step/end` | `data.turn,step` | 结束 step、回 idle，open 若有有效 sample 在此结算 |
| `turn/end` | `data.turn,reason` | idle 且正确 turn 才是完整轮 |

stream usage 的精确形状：`{type:'chunk',time,chunk:{type:'usage',usage:{inputTokens,outputTokens,totalTokens?,cacheReadTokens?,cacheWriteTokens?,reasoningTokens?}}}`。其他 stream record 包含文本/工具参数，跳过其 payload。官方 [assistant-stream.ts](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/llm/llm/src/assistant-stream.ts#L20-L44)、[retry types](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/llm/llm-retry/src/types.ts) 是字段依据。

官方 exact 校验：所有计数为非负安全整数；若 total 存在，`total-output >= 已知input+cacheRead+cacheWrite`，缓存两桶都明确时要求相等；若 total 不存在，缓存两桶都明确才能合成精确 total。reasoning<=output；溢出、矛盾、缺边界、未闭合轮一律不声称 exact。可保留已证明的部分数量并标 incomplete，但不能与官方 exact 标记混淆。attempt identity 用 `(sessionId,turn,step,attempt ordinal/settlement seq)`，usage sample 不是一个新请求。

失败 `assistant/attempt` 通常没有 model；官方聚合也只在所有 attempt 都有 route 时披露完整 routes。`llm/retry.provider` 不等于模型。不将失败 attempt 全套用最后成功模型；模型不明则数量保留、价格未定，除非同一次 request 的 metadata 可证明 route。

参考：[Vibe DSH parser](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/dsh.js) 提供 format0–3、压缩和 replay 的独立兼容证据。继承/选择规则、官方 attempt 规则要分别验证，不能直接拼接两种聚合后重复计数。

## 6. Cola

官方 [local data](https://docs.colaos.ai/en/privacy-and-local-data/) 确认 `~/.cola` 保存 runtime/session；[session events](https://docs.colaos.ai/en/plugin-session-events/) 明说 Pi session 构造/重载；[CLI](https://docs.colaos.ai/en/cli/) 连接正在运行的桌面端。因此桌面与 CLI 可能共用同一份会话，不宜按客户端各算一遍。plugin lifecycle 事件为 best-effort，不是 token 账本。

Vibe 观察的精确根为 `${COLA_DATA_DIR:-~/.cola}/sessions/**/*.jsonl`。scope 子目录可能是渠道/联系人，不能从它推项目；只有 header.cwd 可给项目。JSONL header `type=session,id,timestamp,cwd`；record `type=message,id,parentId,timestamp,message:{role,model|modelId,usage}`。只读 assistant usage：`input,output,cacheRead,cacheWrite`；reasoning 若有从 `reasoning` 或兼容字段提取。

Pi 官方 [types.ts L383–395](https://github.com/earendil-works/pi/blob/60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759/packages/ai/src/types.ts#L383-L395) 确认 input/cache 分离、reasoning 是 output 子集，现代 `cacheWrite1h` 是 cacheWrite 子集。故 `write1h=min(cacheWrite,cacheWrite1h)`，其余 write 在提供明确 TTL 时分类，否则保留 unknown。Vibe 当前没有完整保留这些 TTL 区分，Maclawd 可按官方字段改善。

复制会话会换 header ID/time，但可能保留原 record ID。Vibe 使用 `(entry.id, original timestamp, parentId,role,model)` 为复制记录身份，不能只用短 ID，也不能把 sessionId 纳入后导致复制重新算。多份同身份记录保留较完整 usage；owner 优先早 header 时间、再稳定 session ID/path。仅复制的历史不制造新会话用量，复制后新增 record 应正常计入；无 ID 的行不做文本或数值模糊去重。新 copy/删除/重写会影响所有权，增量缓存须重算关联组。

这套精确复制规则目前只有 [Vibe pi-session-jsonl.js](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/pi-session-jsonl.js)、[Cola parser](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cola.js) 和人工测试证据；官方共通 Pi 字段已验证，Cola 1.4.4 的实际复制落盘仍应标“待实样验证”。读任一必要分片失败时保留旧完整值，不提交部分和。

## 7. Cindy / CindyGlobal 日账本

官方 [regionUserData.ts](https://github.com/makecindy/cindy/blob/40f087c99c849e93af97363d0e874531e97781fc/apps/desktop/src/main/regionUserData.ts) 定义 `Cindy`（CN）、`CindyGlobal`（global）、内部 `CindyDev`；Electron `--user-data-dir` 可改根。默认 macOS `~/Library/Application Support/<name>`；Windows `%APPDATA%/<name>`；Linux `$XDG_CONFIG_HOME/<name>`。扫描 active `cindy-<owner>.db`，不要把 `.bak`、`.slimming-backup`、WAL 单独当数据库。官方多账户架构文档中的未来 profile proposal 不是当前已经上线的路径。

官方 [schema.ts L1563–1607](https://github.com/makecindy/cindy/blob/40f087c99c849e93af97363d0e874531e97781fc/apps/desktop/src/main/localDb/schema.ts#L1563-L1607)、[dailyModelUsage.ts](https://github.com/makecindy/cindy/blob/40f087c99c849e93af97363d0e874531e97781fc/apps/desktop/src/main/localDb/dailyModelUsage.ts) 是主证据：

| 列 | 语义 |
|---|---|
| `day` | 本地时区 `YYYY-MM-DD`，不是 UTC、不是 request timestamp |
| `agent_kind` | `claude-code` / `codex` / `pi` |
| `model` | SDK model，可能带 billing 标记；unknown 不能猜 |
| `input_tokens,output_tokens,cache_read_tokens,cache_create_tokens` | 每 turn delta 累计的独立桶 |
| `updated_at` | 最后更新 Unix 毫秒，用于缓存变化，不是该行所有 token 的消费时间 |
| `cost_currency` | 与 day/agent/model 一起组成主键，币种切换不是复制 token |
| `cost_usd,cost_amount,cost_is_approximate` | 与 token 是另一个账务契约；本次最小 token 导入不读取、不混用 |

允许 SQL：显式选 day、agent_kind、model、四个 token 列，按 day/agent_kind/model 求和跨 currency；不选任何对话或认证数据。按年月日组件构造本地日期并 roundtrip 校验，避免非法日期 rollover。**只有日粒度**，不能伪造 session/request/context length；当天30万 token 不等于某请求30万输入。

官方 [sessionCodexTurnUsage.ts L70–100](https://github.com/makecindy/cindy/blob/40f087c99c849e93af97363d0e874531e97781fc/apps/desktop/src/main/maker-ipc/sessionCodexTurnUsage.ts#L70-L100) 明确 promptTokens 为本 turn 未命中输入、completionTokens 已含 reasoning、cached/cacheCreation 独立、全是 per-turn（不得再差分）。账本映射直接保留四桶；reasoning 未分拆就是 unknown，不声称0已报告；缓存 TTL 未提供不猜。

模型中 `#billing=api` / `#billing=subscription` 是官方 [usageHistory.ts L348–372](https://github.com/makecindy/cindy/blob/40f087c99c849e93af97363d0e874531e97781fc/apps/desktop/src/main/usage/usageHistory.ts#L348-L372) 的会计标记。保留 billing metadata，仅在价格查找时剥离**已证实的末尾标记**，不要顺手删除 provider/tier/context 后缀。subscription 只能是 API 等价估值。

**来源所有权：**Vibe 仅导入 `codex→codex`、`pi→pi-coding-agent`，跳过 Claude，因为 Claude SDK 已写原生 `~/.claude`。官方 Cindy Codex home 为 `<userData>/codex-home`，若 Maclawd 以后扫描了这个私有原生日志，就必须在同一 harness/profile 选择原生或账本之一；日账本没有 request ID，不能与原生逐条可靠去重。不要同时相加。库可记录地区来源，但不因 CN/global 同 model 就合并账户。

日账本是 snapshot：缓存 identity 可用 `canonical-db/day/agent/model`；WAL 改变需重读并替换，不能将每次快照累加。官方明确不做旧历史 backfill，导入前的空白不是已证明历史0。老版本缺表可标 unsupported/未记录；missing column、锁冲突、读取失败应 incomplete + last-good。参考 [Vibe cindy-ledger.js](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/cindy-ledger.js)。Vibe 把 cacheCreate 加进其 input bucket，Maclawd 的细分桶更丰富，应保存独立 write，不能直接照搬该中间表示。

## 8. Trae CLI

根目录：macOS `~/Library/Caches/trae-cli/sessions`；Windows `%LOCALAPPDATA%/trae-cli/cache/sessions`；Linux `${XDG_CACHE_HOME:-~/.cache}/trae-cli/sessions`。每会话 `session.json` 只读 metadata.cwd/model_name；`traces.jsonl` 只读 span/trace identity、startTime、tags 的 usage/model/category；`events.jsonl` 只用 created_at 和事件类型做活动时间，不读消息正文。

| 字段 | Vibe 当前观察 |
|---|---|
| `startTime` | **微秒**，除1000后给 Date；现有 Maclawd 的秒/毫秒猜测无法正确覆盖 |
| `tags` | `{key,value}[]`，转 map |
| 模型 | `model.name`，再 `semantic.name`，最后 session metadata.model_name |
| usage | `usage.input_tokens,usage.output_tokens,usage.cache_read_tokens,usage.reasoning_tokens` |
| span 层 | `span.category`，优先 `model.stream.eino`，同时计独立 `model.generate` failover |

同一真实调用会在 `model.stream.eino` / `model.real_call` / `model.call` 多层复制 usage；全部相加会近3倍。`traceID` 是会话级，不能用它取 max，否则多个顺序请求只剩一个。一个会话无 primary/failover 时，Vibe 依次 fallback real_call、call、其他 usage span。优先层内保留每个独立调用；同 spanID 的重复更新才可选完整一次。

输入/cacheRead 按 Vibe 是独立桶，输出/reasoning 按 Vibe 是独立桶。因此映射到 Maclawd 需 `output=reportedOutput+reportedReasoning`，reasoning 为子集，但这是**来自 Vibe 的产品样本观察，未找到 Trae CLI 官方或第二独立协议证明**。可以实现明确格式的兼容路径并标待验证，不能扩大声称为所有 Trae 产品的通用规则。

还应记录 Vibe 的限制：category 选择是整会话级；混合新旧格式可能存在某些调用只有 fallback 层而另一些有 primary 的情况，不能保证 global filter 永远完整。若没有 parentSpanID 等证明，避免凭时间近似合并真实不同请求。读巨大文件应流式（PR 作者观察 events.jsonl 可达844MB）；只把未完成最后一行留待下一轮，普通读错误不返回成功0。

主要证据：[Vibe Trae parser](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/trae-cli.js)、[PR #65](https://github.com/vibe-cafe/vibe-usage/pull/65)，修复 commit `556b1c57551a37c290c103244b76e5858e1d2e7f`。两个来源属于同一实现家族，不能包装成两份独立验证；本机没有 CLI 样本。TRAE SOLO 的加密 sqlite 和开源 trae-agent 的 trajectories 不在此格式支持承诺内。

## 9. 未知模型与 alias：不猜历史价格

- **MiniMax**：数值样本存在 model unknown 的情况。产品版本、当前默认模型、安装时间都不能证明历史调用实际 route。本次没有发现足够依据补齐 model；数量保留，费用覆盖率明确把它们计为未定价。只有同一 usage record/session 的可信 model metadata 才可补全，不能读取正文推测。
- **Kimi**：官方 [Models](https://www.kimi.com/code/docs/en/kimi-code/models.html) 当前将 `kimi-for-coding` 展示为 **K2.8 Preview**，`kimi-for-coding-highspeed` 为 **K2.7 Code HighSpeed**；还列 `k3`、`k3-256k`。这明确说明 alias 会原地升级。可用于带时间的当前展示，不足以把所有历史 kimi-for-coding 套到某一代价格；套餐 quota 倍率不是美元单价，K3 thinking 路由也可能改变实际模型。
- **Qwen**：官方 [default-qwen-model.ts](https://github.com/QwenLM/qwen-code/blob/e4755ef6abb53a83316076f0e9e53f5f08c1f844/packages/core/src/utils/default-qwen-model.ts) 设 `coder-model` 为默认；[config/models.ts](https://github.com/QwenLM/qwen-code/blob/e4755ef6abb53a83316076f0e9e53f5f08c1f844/packages/core/src/config/models.ts) 另列 mainline `qwen3.7-max`，并未证明二者同一价格路由。测试注释还有较早 Qwen3.6 Plus 的 alias 描述，与其他源码语境不一致；因此不能凭当前 default 把历史 coder-model 映射到3.7/3.6/Coder。优先实际 response model，否则保留 alias/unpriced。

## 10. 最小验证清单与材料位置

实现后应覆盖有意义的行为：Qoder 两地区、IDE WAL、cache 子集、CLI credits-only、schema失败；DSH format0–3/最高generation/父继承/多frame/失败attempt与retry一次结算/缺model/不完整turn；Cola原会话+复制+新记录/短ID碰撞/cacheWrite1h；Cindy两地区多账号/跨币种/本地日期/billing标记/原生日志所有权/更新快照/无历史backfill；Trae微秒、多层同调用、顺序调用、failover、fallback、截断尾行和流式文件。

只通过人工 fixture 的新来源应标为实现兼容、待本机实样验证；不要把产品安装、源目录存在、测试通过等同于真实账单准确。费用方面还受价格快照、缓存TTL、逐请求context和provider/tier缺失限制。

可用本地公开上游镜像：

- `/tmp/maclawd-vibe-current/cli`、`/tmp/maclawd-vibe-current/app`
- `/tmp/maclawd-source-contracts/dsh-official`
- `/tmp/maclawd-source-contracts/cindy-official`
- `/tmp/maclawd-source-contracts/agent-trail`
- `/tmp/maclawd-source-contracts/pi-official`
- `/tmp/maclawd-source-contracts/qwen-official`

这些目录仅用于本次研究，不是用户资料缓存。资料可能变化；后续实施若跨日或切换版本应再次核对 relevant HEAD/tag，不能把本报告永久当作最新协议。
