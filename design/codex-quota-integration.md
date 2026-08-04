# Codex 订阅额度读取集成研究

研究日期：2026-08-04

本机验证版本：`codex-cli 0.146.0`

对应官方源码版本：[`openai/codex@e363b08c9175ac1cbe5893615dd2cb9ddf95043b`](https://github.com/openai/codex/commit/e363b08c9175ac1cbe5893615dd2cb9ddf95043b)（`rust-v0.146.0`）。下文 GitHub 链接均固定到该提交。

## 结论

Maclawd 可以通过本机官方 Codex CLI 的 `codex app-server --stdio` 读取真实的 ChatGPT/Codex 订阅额度，无需读取或解析 `~/.codex/auth.json`，也不需要调用私有网页接口。

应使用的 RPC 是：

```json
{ "method": "account/rateLimits/read", "id": 2 }
```

它返回后端给出的 `usedPercent`、`windowDurationMins` 和 `resetsAt`，可以直接构造准确的百分比条和重置时间。官方将其称为 ChatGPT rate limits；当前产品文档说明 ChatGPT Work 与 Codex 共用 usage，因此 UI 的服务名称建议显示为 **Codex（ChatGPT 订阅）** 或至少在说明文字中标出“与 ChatGPT Work 共用”。[OpenAI 当前定价说明](https://developers.openai.com/codex/pricing) [app-server auth API](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L2076-L2098)

推荐 Maclawd 使用**按需短进程**：刷新额度时启动一个 `codex app-server --stdio`，完成初始化和一次读取后终止；不必保持 app-server 常驻。只有未来希望接收实时的 `account/rateLimits/updated` 通知时，才值得维护常驻进程。

## 1. 本机能力确认

本机命令结果：

- `command -v codex`：`/opt/homebrew/bin/codex`
- `codex --version`：`codex-cli 0.146.0`
- `codex login status`：已通过 ChatGPT 登录
- `codex app-server --help`：默认和显式 `--stdio` 都支持 stdio transport
- `codex app-server generate-json-schema --experimental --out DIR`：生成的当前版本 schema 包含 `account/rateLimits/read`、`account/rateLimits/updated`、`GetAccountRateLimitsResponse`、`RateLimitSnapshot` 和 `RateLimitWindow`

本机还完成了一次真实但去敏的调用验证：进程启动、初始化、读取额度、终止总计约 1.2 秒；返回 `limitId: "codex"`，窗口对象包含 `usedPercent`、`windowDurationMins`、`resetsAt`。本次响应的 `codex` 主窗口是 10,080 分钟且次窗口为空，同时 `rateLimitsByLimitId` 中存在多个 bucket。由此也可确认：**不能假设 `primary` 永远是 5 小时或 `secondary` 永远是每周；必须按服务端返回的窗口时长动态命名和排序。**

官方明确说明，生成的 TypeScript/JSON Schema 与执行生成命令的 CLI 版本匹配，因此实现可在开发/测试时用本机 schema 校验兼容性。[协议与 schema 生成说明](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L20-L64)

## 2. 传输与握手

`codex app-server` 的 stdio transport 是逐行 JSON（JSONL），协议类似 JSON-RPC 2.0，但 wire payload 省略 `"jsonrpc":"2.0"`。stdout 只按行解析 JSON；stderr 单独消费或丢弃，不能混进协议流。官方同时提供 WebSocket 和 Unix socket，但 WebSocket 明确为 experimental/unsupported；本地额度读取应使用 stdio。[transport 定义](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L20-L49)

每条新连接必须只初始化一次：

```json
{ "method": "initialize", "id": 1, "params": {
  "clientInfo": {
    "name": "maclawd",
    "title": "Maclawd",
    "version": "<app-version>"
  }
} }
```

等待 `id: 1` 的成功响应后发送无 `id` 通知：

```json
{ "method": "initialized" }
```

随后才发送额度请求：

```json
{ "method": "account/rateLimits/read", "id": 2 }
```

`initialize.params.clientInfo` 是必需字段，包含 `name`、可空 `title`、`version`；服务端响应包含 `userAgent`、`codexHome`、`platformFamily`、`platformOs`。[初始化类型](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server-protocol/src/protocol/v1.rs#L27-L74) 未初始化先请求会得到 `Not initialized`，同一连接重复初始化会得到 `Already initialized`。[生命周期说明](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L76-L102)

`account/rateLimits/read` 没有参数；省略 `params` 最稳妥，`params: null` 在当前 schema 中也被接受。该方法在 v2 client request 表中明确映射到 `GetAccountRateLimitsResponse`。[RPC 注册](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server-protocol/src/protocol/common.rs#L1053-L1057)

## 3. 响应结构

典型响应：

```json
{
  "id": 2,
  "result": {
    "rateLimits": {
      "limitId": "codex",
      "limitName": null,
      "primary": {
        "usedPercent": 25,
        "windowDurationMins": 300,
        "resetsAt": 1785830400
      },
      "secondary": {
        "usedPercent": 18,
        "windowDurationMins": 10080,
        "resetsAt": 1786262400
      },
      "credits": null,
      "individualLimit": null,
      "spendControlReached": null,
      "planType": "pro",
      "rateLimitReachedType": null
    },
    "rateLimitsByLimitId": {
      "codex": { "...": "same snapshot shape" }
    },
    "rateLimitResetCredits": null
  }
}
```

顶层字段：

- `rateLimits`：向后兼容的单 bucket 视图。服务端优先选 `limitId == "codex"`，否则退回第一个 snapshot。
- `rateLimitsByLimitId`：多 bucket 视图，key 是 metered `limit_id`。若存在，应优先取 `rateLimitsByLimitId.codex`；不存在时再退回 `rateLimits`。
- `rateLimitResetCredits`：可选的 earned reset credits，当前展示额度无需使用。

来源：[响应类型](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L291-L310) [服务端选择 `codex` snapshot 的实现](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/src/request_processors/account_processor.rs#L1056-L1093)

每个 snapshot 可包含：

- `limitId`, `limitName`
- `primary`, `secondary`，两者都可能为 `null`
- `credits`
- `individualLimit`（可选月度 spend-control limit）
- `spendControlReached`
- `planType`
- `rateLimitReachedType`

每个窗口只保证 `usedPercent` 必有；`windowDurationMins` 和 `resetsAt` 都可能为 `null`。app-server 会把 core 中的浮点使用率四舍五入成整数。[窗口类型和转换](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L607-L625)

## 4. 到 Maclawd 展示模型的映射

对 `rateLimitsByLimitId.codex ?? rateLimits`：

1. 收集非空的 `primary`、`secondary`。
2. 按 `windowDurationMins` 从短到长排序；不要依赖 primary/secondary 的名字。
3. `usedPercent` 直接作为“已使用百分比”，显示整数并 clamp 到 `0...100` 仅用于进度条绘制；原始值可保留用于诊断。
4. 剩余额度百分比是 `100 - usedPercent`，但 UI 必须明确写“已使用”或“剩余”，不能只显示裸百分比。
5. `resetsAt` 是 Unix timestamp，单位为秒；转换为 `new Date(resetsAt * 1000)`。不要误当毫秒。
6. `windowDurationMins`：
   - `300` → `5 小时`
   - `10080` → `7 天`或`每周`
   - 其他值动态格式化，例如 `< 60` 显示分钟、整小时显示小时、整天显示天；不可丢弃未知窗口。
7. `resetsAt == null` 时显示“重置时间暂不可用”，不要推算或伪造。
8. 没有任何窗口但 snapshot 存在时，展示“Codex 暂未返回额度窗口”，不要显示 `0%`。

官方字段语义明确为：`usedPercent` 是当前 quota window 的使用量，`windowDurationMins` 是窗口长度，`resetsAt` 是下一次重置的 Unix 秒时间戳。[官方字段说明与示例](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L2219-L2260)

建议标准化输出：

```js
{
  provider: "codex",
  providerLabel: "Codex",
  accountKind: "chatgpt_subscription",
  planType: snapshot.planType ?? null,
  fetchedAt: Date.now(),
  windows: [
    {
      durationMinutes: window.windowDurationMins,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt == null ? null : window.resetsAt * 1000
    }
  ],
  stale: false
}
```

## 5. 认证条件与错误降级

此 RPC 只支持使用 Codex/ChatGPT backend 的认证：

- 没有 Codex 认证：JSON-RPC `-32600`，`codex account authentication required to read rate limits`
- 仅 API key 或其他非 ChatGPT backend：JSON-RPC `-32600`，`chatgpt authentication required to read rate limits`
- 上游请求失败或返回空 snapshots：JSON-RPC `-32603`，message 以 `failed to fetch codex rate limits` 开头

这些分支由官方实现直接定义。[认证与上游错误处理](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/src/request_processors/account_processor.rs#L1023-L1054) 标准错误码为 invalid request `-32600`、internal error `-32603`；服务器过载是 `-32001`。[错误码定义](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/src/error_code.rs#L1-L31)

推荐 UI 降级：

- `ENOENT` / `codex --version` 不可用：`未安装 Codex CLI`
- `-32600` 且 message 包含 authentication required：`Codex 尚未通过 ChatGPT 登录`
- API key 模式导致的 ChatGPT authentication required：`当前 Codex 使用 API Key，订阅额度不可用`
- `-32603`、网络错误或 timeout：保留上次成功值并标 `数据可能已过期`；没有缓存才显示 `暂时无法读取`
- malformed JSON、协议字段变化：记录去敏诊断并显示 `当前 Codex 版本暂不兼容`
- `-32001`：短暂 jitter 后最多重试一次；官方要求对此错误做指数退避加 jitter。[backpressure 说明](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L51-L55)

不要把 Codex 读取失败影响 Claude 额度展示；provider 之间独立成功、独立失败、独立缓存。

## 6. 进程生命周期与超时建议

### 推荐：按需短进程

每次刷新：

1. 使用已解析并校验的 Codex 可执行文件路径直接 spawn，参数 `app-server --stdio`，不要拼接 shell command。
2. 启动后立即发送 `initialize`。
3. 收到 initialize response 后发送 `initialized`，再发 `account/rateLimits/read`。
4. 收到 `id: 2` 的 result/error 后关闭 stdin 并发送 `SIGTERM`；250ms 后仍未退出才发送 `SIGKILL`。调用 Promise 在收到 `exit` 后完成（异常实现不发 `exit` 时有 750ms 的最终上界）。
5. 任何阶段达到总 timeout 都终止整个子进程，并清理 stdout/stderr listener。

建议 timeout：总计 8–10 秒，其中启动/初始化 3 秒、额度请求剩余时间。官方没有为此 RPC 规定客户端 timeout；数值是 Maclawd 的防挂死策略。本机实测成功路径约 1.2 秒，因此 8–10 秒留有充足网络余量。

刷新频率建议 5–15 分钟，并在用户打开额度页时允许一次 refresh-on-open。额度窗口本身是小时/天级，不应每秒启动 CLI。

### 是否需要常驻

不需要。一次 snapshot 请求是完整可用的，官方也明确提供 `account/rateLimits/read` 作为主动 fetch。按需短进程的优点是没有 orphan daemon、版本漂移和长期 stdout framing 状态。

常驻的唯一明显收益是接收：

```json
{ "method": "account/rateLimits/updated", "params": { "rateLimits": { "...": "..." } } }
```

但这是 sparse rolling update。客户端必须把可用字段 merge 到最近一次 read snapshot，nullable account metadata 在通知中不表示清除旧值；也可以收到通知后直接 refetch snapshot。[通知合并语义](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L510-L535)

如果未来确实复用常驻 daemon，官方有 `codex app-server daemon start` 和 `codex app-server proxy`，但 daemon 当前明确是 experimental，主要面向 SSH remote-management；不建议仅为额度展示引入这一生命周期依赖。[daemon 官方说明](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server-daemon/README.md#L1-L26)

## 7. 安全注意

- 不读取、不复制、不上传 `~/.codex/auth.json` 或 OAuth token；让官方 Codex 进程自行读取并刷新它管理的凭据。官方说明 ChatGPT managed 模式由 Codex 持久化和自动刷新 token。[认证模式](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L2076-L2083)
- 不使用 shell 拼接用户输入或路径；直接 `spawn(executable, ["app-server", "--stdio"])`。
- 优先解析 app bundle 已知路径、`command -v codex` 的绝对路径或用户设置的显式路径，并确认是普通可执行文件；避免让被污染的 PATH 劫持后台进程。
- 不向子进程传递额外 secrets；继承环境时至少避免把 Maclawd 自己的 token 写入日志。
- stdout 仅解析协议，stderr 限长收集；生产日志不要记录完整 response。response 可能包含 plan、credit balance、spend control 和 reset credits，属于账户元数据。
- 对 JSON 行设置最大长度和总输出上限，防止异常子进程无限输出导致内存增长。
- stdio 子进程只需要本机网络和 Codex 自己的配置访问。不要为额度读取开启 WebSocket listener，更不要绑定非 loopback 地址。
- `clientInfo.name` 会用于 OpenAI Compliance Logs Platform 的客户端识别；应使用稳定、真实的 `maclawd` 标识。企业集成需要关注官方 README 中的 known-client 提示。[clientInfo 合规说明](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/app-server/README.md#L98-L102)

## 8. 建议实现验收项

1. ChatGPT 登录且返回 5 小时、每周窗口时，分别显示准确已用百分比、百分比条和重置时间。
2. 只返回一个 10,080 分钟窗口时，显示“7 天/每周”，不误标为“5 小时”。
3. primary/secondary 顺序互换或未知 duration 时，仍按时长正确排序和命名。
4. `rateLimitsByLimitId.codex` 存在时优先使用；不存在时兼容 `rateLimits`。
5. `primary: null`、`secondary: null`、`resetsAt: null`、缺失 plan 等均不崩溃、不显示虚假 0%。
6. 未安装 CLI、未登录、API key 登录、网络失败、超时、malformed JSON 分别有明确降级文案。
7. 上次成功后短暂失败，继续展示旧值并标记 stale；Claude provider 不受影响。
8. 连续刷新不会遗留 `codex app-server` 子进程，也不会并发启动多个额度读取。
9. 真实日志与测试 snapshot 中不落 OAuth token、邮箱、credit balance 等敏感账户数据。
10. 使用当前安装 CLI 生成 schema 的 fixture 测试，并保留旧版缺少 `rateLimitsByLimitId` 的兼容测试。

## 推荐决策

现在直接接入 `codex app-server --stdio` + `account/rateLimits/read`。实现为独立的 Codex quota provider，按需短进程、10 秒硬超时、5–15 分钟缓存；UI 永远显示 provider 名称，并根据 `windowDurationMins` 动态展示窗口。不要通过读取认证文件、模拟网页或维持 experimental daemon 来获取额度。
