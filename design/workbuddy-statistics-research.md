# Tencent WorkBuddy 统计接入调研

> 调研日期：2026-08-04
> 范围：Tencent WorkBuddy 桌面版及其内嵌的 CodeBuddy Code 编程内核。只采用腾讯官方页面、官方文档，以及本机安装包和本地数据的只读验证。

## 结论

可以为 Maclawd 增加 WorkBuddy 统计，但当前仓库里的支持只覆盖旧版存储，不能直接等同于“已支持当前 WorkBuddy”。

- Maclawd 已有 `src/runtime/parsers/workbuddy.js`，读取旧版 `~/.workbuddy/projects/**/*.jsonl`，能够统计 input、output、cache read、reasoning、模型、项目和会话。解析逻辑有真实样本测试，口径本身是可靠的。
- 本机 Tencent WorkBuddy 5.3.8（内嵌 CodeBuddy Code 2.115.0）已经没有 `~/.workbuddy/projects`。桌面层迁到 `~/.workbuddy/workbuddy.db`，且内嵌 CLI 以 `--serve --no-session-persistence` 启动。因此旧解析器在当前版本发现不到数据。
- 官方 CodeBuddy Code 已提供三条更稳定的扩展面：公开统计 REST API、OpenTelemetry traces、Hooks；此外还有 status line。它们属于 **CodeBuddy Code 的公开能力**，不能未经验证就假设 WorkBuddy 桌面壳完全等价支持。
- 推荐顺序是：**先验证有正式认证的 `/api/v1/stats`；认证无法安全取得时，以 OTel 做未来数据的主通道；Hooks 只负责实时状态和触发刷新；保留旧 JSONL 解析兼容历史；SQLite 只作为版本化的会话/额度补充；status line 只作成本兜底。**
- 目前没有找到面向第三方的 WorkBuddy 账号订阅剩余额度 API。不要抓取登录态、复制应用内部 token，或依赖未公开接口。

## 1. 名称与产品边界

这里的 WorkBuddy 是腾讯的 **Tencent WorkBuddy**，官方定义为“全场景 AI Agent 桌面工作站”，同时提供 Work Mode 和 Coding Mode：[WorkBuddy 概览](https://www.workbuddy.ai/docs/workbuddy/)、[快速开始](https://www.workbuddy.ai/docs/workbuddy/Quickstart)。

Coding Mode 的执行内核是 **CodeBuddy Code**。CodeBuddy Code 是单独可安装的 CLI/Agent 产品，拥有自己的 CLI、SDK、Hooks 和 HTTP API：[CodeBuddy Code 概览](https://www.workbuddy.ai/docs/cli/)。官方 v2.48.0 发布说明明确写明 WorkBuddy 从那一版起使用独立的 `.workbuddy/` 配置目录，与 CLI 的 `.codebuddy/` 分离：[v2.48.0 发布说明](https://www.workbuddy.ai/docs/cli/release-notes/v2.48.0)。

因此本文区分两层：

| 层 | 数据与配置 | 对 Maclawd 的含义 |
|---|---|---|
| WorkBuddy 桌面版 | `~/.workbuddy/`、桌面任务数据库、动态启动的本地 CodeBuddy 服务 | 用户实际需要统计的产品；存储和进程编排由桌面壳控制 |
| CodeBuddy Code CLI | 默认 `~/.codebuddy/`，公开 Hooks、SDK、REST、OTel | 可利用的官方观测能力；需逐项验证桌面壳是否启用、如何认证 |

不要混淆另一个 `docs.work-buddy.ai` 的开源 “Work Buddy”。它是基于 Claude Code/Obsidian 的不同项目，不是本次目标。

## 2. 官方已提供的统计与观测能力

### 2.1 `/cost` 与结构化结果

CodeBuddy Code 的 `/cost` 会显示当前会话按模型拆分的 input、output、cache read、cache write；`/context` 显示当前上下文占用：[成本管理](https://www.workbuddy.ai/docs/cli/costs)。

Headless JSON 和 Agent SDK 的最终 `result` 包含 `total_cost_usd` 以及 `usage.input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`：[Headless Mode](https://www.workbuddy.ai/docs/cli/headless)、[TypeScript SDK Reference](https://www.workbuddy.ai/docs/cli/sdk-typescript)。这证明内核内部已有 Maclawd 所需的核心计数，但主动发起新任务的 SDK/Headless 模式不能旁路观察用户正在 WorkBuddy 中进行的既有任务。

### 2.2 公开统计 REST API

`codebuddy --serve` 的公开 API 包含：

- `GET /api/v1/stats`：跨项目历史用量统计；
- `GET /api/v1/stats/session`：当前会话实时成本统计；
- `GET /api/v1/sessions`：会话列表；
- `GET /api/v1/traces`：trace 与 span 列表。

官方把 `/api/v1/*` 定义为遵循语义化版本、无破坏性变更的公开 REST 层；`/internal/*` 才是无稳定性承诺的内部层：[CodeBuddy Code HTTP API Beta](https://www.workbuddy.ai/docs/cli/http-api)。

这是最理想的读取面，因为它由产品自己聚合历史与当前会话，Maclawd 不必推断私有文件结构。不过它仍是 Beta，并且 WorkBuddy 桌面壳启用了认证。

### 2.3 Hooks

CodeBuddy Code 支持 27+ 事件，包括 `SessionStart`、`SessionEnd`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Notification`、`Stop`、`SubagentStart`、`SubagentStop` 等。Hook 通过 stdin 收到 `session_id`、`transcript_path`、`cwd`、`permission_mode` 和事件字段：[Hooks Reference](https://www.workbuddy.ai/docs/cli/hooks)。

这很适合桌宠实时状态：开始处理、调用工具、等待权限/输入、子 Agent、结束。但 Hook 输入没有官方承诺的逐次 token usage，不能单独充当精确用量源。它最适合：

1. 向 Maclawd 发非阻塞事件；
2. 在 `Stop`/`SessionEnd` 后触发一次统计 API 或本地增量扫描；
3. 用 `session_id` 将状态事件和统计记录关联。

官方 Hooks 默认超时 60 秒、同一事件匹配项并行执行；退出码 2 会阻断行为，因此 Maclawd Hook 必须快速、退出 0、不可处理权限决策：[Hooks Reference](https://www.workbuddy.ai/docs/cli/hooks)。

### 2.4 OpenTelemetry

CodeBuddy Code 支持通过 OTLP 导出 traces。启用 `OTEL_SEMCONV=agentlens` 后，LLM span 可带 `gen_ai.usage.input_tokens`、`output_tokens`、`total_tokens`、模型、TTFT、finish reason 等字段。官方同时说明：只有上游返回 usage 时才有 token 字段；当前只支持自定义导出 traces，不支持自定义 metrics/logs：[Monitoring CodeBuddy Code with OpenTelemetry](https://www.workbuddy.ai/docs/cli/monitoring)。

优点：

- 属于正式观测协议，适合逐调用实时采集；
- 同一条链上还能得到 Agent、工具、MCP、模型请求等状态信息；
- 不依赖 WorkBuddy 私有数据库结构。

限制：

- 只能覆盖启用后的新数据，不能补历史；
- 需要让 WorkBuddy 启动的内嵌 CLI 获得 OTel 环境变量，并让 Maclawd 提供本地 OTLP HTTP receiver；通常需要重启 WorkBuddy；
- token 字段依赖上游响应；官方语义字段只明确 input/output/total，缓存读写是否能稳定映射到 Maclawd 的四段口径仍需实测；
- `OTEL_LOG_USER_PROMPTS`、`OTEL_LOG_TOOL_CONTENT` 等内容开关默认应保持关闭，避免采集用户提示、文件内容或工具结果。

本机 2.115.0 的 bundle 中可只读检出 `OTEL_TRACES_EXPORTER`、`OTEL_SEMCONV` 及 `/api/v1/stats` 路由，说明这些能力已编入当前安装，而不只是最新版网页文档中的未来能力。

### 2.5 status line

status line 命令会在对话消息更新时运行，最高约每 300ms 一次，并通过 stdin 获得 `session_id`、model、workspace、version，以及 `cost.total_cost_usd`、API/总耗时、增删行数：[Status Line Configuration](https://www.workbuddy.ai/docs/cli/statusline)。

它的局限很明确：

- 官方输入结构没有逐类 token 和 cache 字段；
- 它是终端 UI 的展示扩展，WorkBuddy 桌面版以内嵌 `--serve` 方式运行时是否触发，必须实测，不能仅凭 CLI 文档假设；
- 高频执行脚本不适合作为唯一持久化链路。

所以它可以补充“当前成本/耗时”，但不应成为 Maclawd 的 canonical token source。

## 3. 本机可验证的数据现状

本机只读检查结果：

- WorkBuddy 应用版本：5.3.8；内嵌 CodeBuddy Code：2.115.0。
- `~/.workbuddy/projects` 不存在；当前仓库的 WorkBuddy parser 因而发现 0 个 JSONL。
- `~/.workbuddy/workbuddy.db` 存在，包含 `sessions`、`workspaces`、`session_usage` 等表。
- `sessions` 表保存 cwd、状态、时间、model、permission mode 等会话元数据。
- `session_usage` 表只有 `session_id`、`used`、`size`、`updated_at`、`credit_json`；当前本机表为空。仅凭 schema 无法证明 `used/size` 是 token、上下文占用还是积分，`credit_json` 的结构也没有公开稳定契约。
- 内嵌 CodeBuddy 进程的启动参数包含 `--serve --no-session-persistence --setting-sources user --port 0`。服务地址通过 `~/.workbuddy/sessions/<pid>.json` 的 `url/endpoint` 动态发布。
- 访问当前服务的 `/api/v1/auth/status` 返回“认证已启用、当前未认证”；在没有凭据时访问 `/api/v1/stats` 和 `/api/v1/stats/session` 返回 401。

这些结果解释了新旧差距：旧版桌面壳曾将可解析的消息 JSONL 放在 `~/.workbuddy/projects`；当前桌面壳禁用内核自身的会话落盘，改由 WorkBuddy 桌面数据库和受认证的本地服务管理。

## 4. 接入方案比较

| 方案 | 可得数据 | 历史 | 实时 | 稳定性 | 当前可行性 | 结论 |
|---|---|---:|---:|---|---|---|
| 旧 `projects/*.jsonl` 解析 | token、cache、reasoning、model、cwd、session | 是 | 增量 | 私有文件格式 | 仅旧版 | 保留兼容，不再宣称覆盖新版 |
| `workbuddy.db` 只读 | 会话、状态、model；可能有 usage/credit 摘要 | 是 | 轮询 | 私有 schema | 可读，但当前 usage 空且语义未知 | 只作版本化补充，不猜字段 |
| 公共 `/api/v1/stats*` | 官方聚合历史/当前成本统计 | 是 | 是 | 公开 Beta API | 路由存在，但桌面服务要求认证 | **有安全认证时首选** |
| OTel/OTLP | 每次 LLM 调用 token、模型、trace、工具阶段 | 否 | 是 | 标准协议 + 官方支持 | 当前 bundle 已包含；需配置与重启 | **认证 API 不通时的主通道** |
| Hooks | 会话/工具/等待/完成/子 Agent 事件 | 否 | 是 | 官方扩展面 | 很可能可用，仍需桌面实测 | 状态增强与刷新触发，不做 token 主源 |
| status line | 会话、模型、累计美元成本、耗时、改动行数 | 否 | 是 | 官方 CLI UI 能力 | 桌面 `--serve` 是否触发未知 | 成本兜底，优先级最低 |
| SDK/Headless JSON | 发起任务后的 usage 与 cost | 单次 | 是 | 官方 SDK | 不能旁观 WorkBuddy 现有任务 | 不用于全局统计 |
| 账号订阅接口 | plan、credits、消费、订阅状态 | 云端 | 是 | 未发现公开接口 | 不可行 | 等官方 API，不抓私有登录态 |

## 5. 认证 API 的可行性

官方 Gateway 支持 `none` 和 `password` 两种认证；password 模式可通过 Bearer 或登录接口获取 token，请求还需 `X-CodeBuddy-Request: 1`：[HTTP API Security / Authentication](https://www.workbuddy.ai/docs/cli/http-api)。

对独立 CodeBuddy CLI，Maclawd 可以让用户明确配置一个仅 loopback 使用的 Gateway password，再调用公开统计 API。对 WorkBuddy 桌面版，当前 password/token 由应用管理，Maclawd 没有官方授权的凭据交付机制。

不推荐的做法：

- 从 WorkBuddy 日志或命令行中提取内部 token；
- 注入到应用 IPC、读取 Cookies/Keychain；
- 调用 `/internal/*`；
- 擅自关闭认证；
- 代理或拦截模型网络流量。

这些方案安全脆弱、升级易坏，也越过了公开 API 的认证边界。正确的前置实验是：确认 WorkBuddy 是否允许用户在 `~/.workbuddy/settings.json` 中设置一个自有 `gateway.password`，且不会破坏桌面客户端与内核的连接。只有验证通过后，才将 API 作为默认采集源。

## 6. 订阅额度与成本

腾讯官方隐私政策明确说明服务会处理 plan type、credits balance、usage consumption、credit/token usage records、subscription status，证明云端确实存在这类数据：[Tencent WorkBuddy Privacy Policy](https://www.workbuddy.ai/document/privacy-policy)。但这不是第三方读取 API 的承诺。

目前官方公开资料只证明：

- CodeBuddy 会话内部能够计算 token 与 `total_cost_usd`；
- WorkBuddy 账号侧存在 credits/订阅/消费记录；
- 本地 SQLite 预留了 `credit_json`。

没有找到公开、稳定、可授权给 Maclawd 的“订阅剩余百分比/重置时间”接口。Maclawd 可以显示本地 token 与模型价格估算，但应标注为估算，不能伪装成官方订阅额度。只有当 `credit_json` 在真实账号样本中出现、字段语义可从公开契约确认，或腾讯发布额度 API 后，才应增加额度卡片。

## 7. 推荐实施阶段

### P0：修正当前支持声明

1. 保留现有旧版 JSONL parser 和全部口径测试。
2. 探测 WorkBuddy 版本、`projects`、`workbuddy.db` 和活动 server endpoint。
3. `projects` 不存在时显示“检测到新版 WorkBuddy，统计接入待启用”，不要显示为已成功采集但 0 token。
4. 增加 fixture，覆盖旧 JSONL 与新版空数据库，避免把“没数据”误判为“没有使用”。

### P1：官方统计 API spike（首选，但以认证为门槛）

1. 从 `~/.workbuddy/sessions/*.json` 只读取动态 endpoint，不读取或搜集 secret。
2. 仅调用 `/api/v1/auth/status`、`/api/v1/stats`、`/api/v1/stats/session`。
3. 验证用户自设 Gateway password 的方式以及 WorkBuddy 自身是否仍正常工作。
4. 固化响应 fixture，再映射到 Maclawd 的 input/output/cache/reasoning/cost 口径。
5. API 不可认证时静默回退，绝不尝试内部 token。

### P1 备选：OTel 实时采集

1. Maclawd daemon 增加只监听 `127.0.0.1` 的 OTLP/HTTP receiver。
2. 用户显式开启“WorkBuddy 实时统计增强”，由设置合并写入最少配置：OTLP endpoint、trace exporter、`OTEL_SEMCONV=agentlens`。
3. 内容记录开关全部保持关闭；UI 明示需重启 WorkBuddy，只影响未来用量。
4. 用真实模型分别验证缓存命中、reasoning、子 Agent、失败/重试、多模型路由，确认不会双计 `model_request` 与 `model_stream`。官方文档特别说明 agentlens 下不导出 `model_request`，正是为了避免双计：[OTel monitoring](https://www.workbuddy.ai/docs/cli/monitoring)。
5. 若 span 缺 cache breakdown，则 OTel 只作为实时总量/事件源；有 JSONL/API 明细时由后者覆盖。

### P2：Hooks 事件增强

1. 合并写入 `~/.workbuddy/settings.json`，不覆盖用户已有 Hooks。
2. 监听 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Notification`、`SubagentStart/Stop`、`Stop`、`SessionEnd`。
3. Hook 只向本地 Maclawd socket/HTTP endpoint 发最小事件，超时极短，永远不批准/拒绝权限。
4. `Stop`/`SessionEnd` 触发 API/数据库增量刷新。

建议文案：

> 让 Maclawd 通过 WorkBuddy 的 CodeBuddy Hooks 实时接收运行事件，使桌宠动作和状态判断更加精准。会向 `~/.workbuddy/settings.json` 添加 hooks，不覆盖已有配置，也不处理权限。

### P3：SQLite 会话补充

给 `workbuddy.db` 建独立、严格版本检测的只读 adapter，只读取稳定可验证的会话 metadata。只有拿到非空 `session_usage` 的真实样本并确认 `used/size/credit_json` 语义后，才扩展用量/额度映射。未知 schema 或数据库锁定时立即回退，不复制数据库，不写入表。

### P4：status line 成本兜底

只有实测证明 WorkBuddy 的 `--serve` 会调用 status line 时才启用。它可提供累计美元成本、耗时和改动行数，但不与 token 明细混为一谈；执行频率要节流并按 `session_id` 覆盖最新快照，而不是累加每次输入。

## 8. 风险与发布门槛

- **兼容性**：HTTP API 是 Beta；WorkBuddy 桌面数据库是私有 schema；所有采集器都要 capability/version gate 和回退路径。
- **隐私**：OTel 与 Hooks 只传事件和计数，默认不传 prompt、工具参数、文件路径或结果正文。
- **凭据**：Maclawd 不读取 WorkBuddy Cookies、Keychain、日志 token 或进程参数中的 secret。
- **口径**：Maclawd 的 canonical 约束仍是 input 不含缓存、output 包含 reasoning；没有 cache breakdown 时不得伪造。
- **重复计数**：API、OTel、旧 JSONL 同时存在时必须定义来源优先级与 session/call 去重，不能简单相加。
- **用户授权**：腾讯 WorkBuddy 可接受使用政策限制未经书面许可开发与服务互操作的外部组件：[Acceptable Use Policy](https://www.workbuddy.ai/document/acceptable-use-policy)。在产品化发布前应向 `workbuddy_ai@tencent.com` 确认本地只读统计、Hooks/OTel 接入的允许范围；用户应显式开启增强功能。

## 最终建议

短期可以诚实地做到“旧版 WorkBuddy token 统计 + 新版 WorkBuddy 检测”，但不能只靠现有 parser 宣称完整支持 WorkBuddy 5.3.8。

新版的最佳架构是：

1. **公开 `/api/v1/stats*`**：有用户可控、安全认证时作为历史与当前累计的主源；
2. **OTel**：作为未来逐调用 token 与 trace 的实时主源/回退；
3. **Hooks**：驱动桌宠状态，并触发统计刷新；
4. **SQLite**：补会话元数据，暂不猜 token/credits；
5. **旧 JSONL**：兼容历史版本；
6. **status line**：只补累计成本，最后采用。

账号订阅额度暂缓，等待官方公开 API 或明确授权的本地字段契约。

## 9. 月度积分（Credits）与首页额度进度条专项结论

### 9.1 官方能够确认什么

WorkBuddy 的官方定价页确认 Credits 是套餐权益，而不是 token 的同义词；WorkBuddy 与 CodeBuddy 共用账号及积分。当前公开套餐按月给出积分额度，且套餐、活动与地区会改变具体数值：[WorkBuddy Pricing](https://www.workbuddy.ai/pricing/)。

国际版官方公告还给出了 2026-08-07 起的新规则：[WorkBuddy International Edition — Personal Plan Pricing & Credits Update](https://www.workbuddy.ai/announcement/)。

- Free：每月 100 基础积分；限时活动期间，每个活跃日再得 30，宣传上限为每月 1,000。
- Pro：每月 1,000 基础 + 1,000 赠送；限时活动期间，每个活跃日再得 50，宣传上限为每月 3,500。
- 新用户 250 积分有效期为两周；一次性 Pro 试用的 500 积分有效期为 7 天。
- 加量包为 500 Credits / USD 15，有效期 1 个月。
- 公告写明用户可以在账号中查看 balance 和 usage history，也会在接近 monthly limit 时收到通知。

这说明一个账号可能同时存在基础月度额度、月度赠送、按日活动赠送、注册赠送、试用积分和加量包等多个积分桶，而且有效期并不相同。官方还说明老订阅用户从“下一计费周期”升级权益，因此付费套餐的周期边界更像订阅计费周期，而不能安全假设为每个自然月 1 日重置。

官方隐私政策进一步确认腾讯会处理 plan type、credits balance、usage consumption records、credit/token usage records 和 subscription status，但该政策只是数据处理说明，并未提供第三方读取契约：[Tencent WorkBuddy Privacy Policy](https://www.workbuddy.ai/document/privacy-policy)。CodeBuddy Code v2.108.2 的官方发布说明提到 Credits 已能正确归属到每个 conversation turn，证明产品内部存在单轮积分消费记录；发布说明同样没有公开字段或查询 API：[v2.108.2](https://www.workbuddy.ai/docs/cli/release-notes/v2.108.2)。

### 9.2 `used / limit / resetAt` 能否获得

| 首页额度字段 | 官方公开信息 | 能否自动可靠获得 | 原因 |
|---|---|---:|---|
| `used` | 账号页面存在 usage history；内部会按 conversation turn 归属 Credits | **不能** | 没有公开 Credits usage endpoint 或 SDK 字段；`/api/v1/stats` 官方只承诺历史使用统计，`/stats/session` 只承诺实时成本，不承诺 Credits |
| `limit` | 定价页公开各套餐的基础/赠送积分规则 | **不能针对当前用户确定** | Maclawd 无公开接口获知当前 plan、地区、活动资格、试用、加量包和额外赠送；“up to”额度也不是固定可用上限 |
| `resetAt` | 公开文案只写“每月”、下一计费周期，以及若干单独有效期 | **不能** | 没有公开返回精确重置时间的契约；多个积分桶可能各自到期，单一 `resetAt` 本身不足以表达真实状态 |

公开的 CodeBuddy Gateway API 列表没有 Credits、plan、subscription 或 balance endpoint；已公开的统计接口只有 `/api/v1/stats` 和 `/api/v1/stats/session`：[CodeBuddy Code HTTP API Beta](https://www.workbuddy.ai/docs/cli/http-api)。Agent SDK 最终结果公开 `total_cost_usd` 与 token usage，但没有 Credits balance/limit/reset 字段：[TypeScript SDK Reference](https://www.workbuddy.ai/docs/cli/sdk-typescript)。

结论是：**截至 2026-08-04，不能用腾讯公开契约安全地为 Maclawd 首页 WorkBuddy 额度条提供真实的 `used / limit / resetAt`。** 即使从公开定价表硬编码 `limit`，也无法可靠知道用户实际套餐和额外积分桶，更无法得到 `used` 与精确到期时间，最终会生成看似精确、实际错误的百分比。

本机 WorkBuddy 5.3.8 的只读实现核对提供了一个重要补充：桌面应用内部的 `getAccountUsage` 确实能得到 `usageLeft`、`usageTotal`、`usageUsed`、`refreshAt` 和 `resources`。也就是说，产品内部实际上具备映射首页进度条所需数据：

| WorkBuddy 内部字段 | Maclawd 可映射字段 |
|---|---|
| `usageUsed` | `used` |
| `usageTotal` | `limit` |
| `usageLeft` | `remaining`，也可校验 `limit - used` |
| `refreshAt` | `resetAt` |
| `resources` | 基础、赠送、加量包等分桶/资源明细 |

但这仍然不改变“当前不能安全接入”的判断：该方法及返回 schema 没有出现在腾讯公开文档、公开 SDK 或公开 `/api/v1` 合同中。桌面实现中个人账号使用的云端路径为 `/v2/billing/meter/get-user-resource`，企业账号为 `/v2/billing/meter/get-enterprise-user-usage`；两者均是 WorkBuddy 自身携带登录态调用的产品内部计费 endpoint，而不是对第三方发布的 API。本文没有调用这些 endpoint，也不建议 Maclawd 复制登录凭据后调用。

### 9.3 如果只能拿到部分信息，首页应如何处理

未来若腾讯公开的授权接口只返回部分字段，应按下列降级规则展示：

| 可获得字段 | 可安全展示 | 不应展示 |
|---|---|---|
| 只有 `balance` | “剩余 N Credits”，标注数据更新时间 | 百分比、已用、重置倒计时 |
| 只有单次 `creditConsumed` | 本次/今日累计消费，明确为本地累计 | 套餐剩余、月度百分比 |
| `balance + limit` | “剩余 N / 当前额度 L”；只有确认两者属于同一积分桶时才算百分比 | 猜测 `resetAt` |
| `used + limit + resetAt` | 才能接入现有标准额度进度条 | — |
| 多积分桶数组 | 分桶显示名称、余额、到期时间；总余额可汇总 | 把最早到期时间冒充整个账号的 reset |

如果用户愿意手动输入套餐，也最多只能显示“套餐公开月度权益”这一静态说明，不能作为实时额度。2026-08-07 的国际版规则包含每日活动积分和多种短期积分，进一步说明用套餐表反推余额并不可靠：[官方积分更新公告](https://www.workbuddy.ai/announcement/)。

### 9.4 内部完整数据和本地 `credit_json` 为什么仍不能接首页

`getAccountUsage` 证明完整额度数据存在，但直接复用它需要借用 WorkBuddy 的云端认证、绑定内部 endpoint 和私有 schema。风险包括：

- 没有版本或兼容性承诺，字段和路径可随 WorkBuddy 更新改变；
- 需要读取或复用 WorkBuddy 登录凭据，越过公开 API 的认证边界；
- 个人与企业 endpoint 不同，`resources` 还可能因地区、套餐、活动而变化；
- 腾讯公开可接受使用政策限制未授权自动化、抓取以及外部组件与服务互操作：[Acceptable Use Policy](https://www.workbuddy.ai/document/acceptable-use-policy)。

因此，这些内部字段适合用来定义未来向腾讯申请的公开合同，也能证明 Maclawd 的 UI 数据模型是可表达的；它们不应直接变成生产采集实现。

本机 `~/.workbuddy/workbuddy.db` 的 `session_usage.credit_json` 看起来与积分有关，但它不是腾讯公开契约，当前样本表为空，并且表级字段只有 session 维度的 `used/size/updated_at/credit_json`。在没有真实非空样本和官方语义说明时，无法判断它表示：

- 本轮/本会话消耗；
- 剩余积分或消费回执；
- 上下文窗口 used/size；
- 单个积分桶还是账号总余额；
- 是否包含到期时间。

因此不能把列名相似性当作额度合同。即使后续能读到 `credit_json`，也必须先确认其中有同一口径的 `used`、`limit`、`resetAt`，并做版本 gate；否则只应作为诊断数据，不进入首页。

### 9.5 推荐决策

1. **当前不新增 WorkBuddy 首页额度进度条。** 保留“用量统计可接、订阅额度暂不可接”的产品边界。
2. 可以在 WorkBuddy 详情中增加静态入口“查看官方积分余额与消费记录”，链接到官方账号/套餐页面，但不要读取浏览器 Cookie 或 WorkBuddy 登录态。
3. 向腾讯申请或等待一个明确授权的只读接口。最理想的方案是腾讯将现有 `getAccountUsage` 能力包装为公开、本机授权的 `/api/v1/account/usage`，或在 SDK 中公开等价方法；最低响应合同应为：

   ```json
   {
     "plan": "pro",
     "buckets": [
       {
         "kind": "monthly_base",
         "used": 0,
         "limit": 1000,
         "remaining": 1000,
         "resetAt": "ISO-8601",
         "expiresAt": "ISO-8601"
       }
     ],
     "updatedAt": "ISO-8601"
   }
   ```

4. 如果官方只愿意返回余额，Maclawd 应新增“余额型额度”展示模式，而不是勉强套用现有百分比进度条。
5. 不从网页私有请求、Cookies、Keychain、进程参数或应用日志中提取账号凭据。腾讯可接受使用政策明确限制未授权的自动化、爬取和外部互操作：[Acceptable Use Policy](https://www.workbuddy.ai/document/acceptable-use-policy)。

**最终判断：月度套餐数值是公开的，但用户的实时 `used / limit / resetAt` 不是公开数据合同；现阶段无法安全接入 Maclawd 首页现有额度进度条。**
