# WorkBuddy 积分读取的开源实现调研

> 调研日期：2026-08-05
> 范围：只查看 GitHub 开源源码和腾讯官方文档；未调用本机私有计费接口，未修改 Maclawd 产品代码。

## 结论

已有开源项目实现了真实的 WorkBuddy 账户 Credits 读取。它们的核心方案不是 Hooks、`workbuddy.db` 或 JSONL，而是：

1. 从 WorkBuddy/CodeBuddy 本地登录文件取得 Bearer access token，或让用户在第三方工具中单独完成 WorkBuddy OAuth。
2. 请求 WorkBuddy 私有计费接口 `POST /v2/billing/meter/get-user-resource`。
3. 解析 `Accounts[]` 中的积分包容量、已用、剩余和周期结束时间，生成 Credits 进度条。

因此，此前“没有可读取入口”的判断需要修正为：

> **没有腾讯公开给第三方的 Credits API，但当前 WorkBuddy 会在本地保存可读的登录凭据，已有开源项目利用它调用私有计费接口。技术上可实现自动读取，但安全、兼容性和服务条款风险需要单独决策。**

## 开源项目对比

| 项目 | 是否是账户 Credits | 凭据方式 | 数据源 | 对 Maclawd 的参考价值 |
|---|---:|---|---|---|
| [TokenBar](https://github.com/GA0LU/TokenBar) | 是 | **自动读本地 `.info`** | 私有 billing API，区分个人/企业 | 最接近 Maclawd，MIT |
| [Metrik](https://github.com/keros68/metrik) | 是 | **自动读本地 `.info`** | 私有 billing API | 自动识别已有实证；AGPL，不应复制代码 |
| [codex-app-transfer](https://github.com/Cmochance/codex-app-transfer) | 是 | 工具自有 OAuth/API key | 私有 billing API | 积分桶解析最清晰，MIT |
| [cockpit-tools](https://github.com/jlcodes99/cockpit-tools) | 是 | OAuth，也支持本机导入 | 私有 billing API | 完整账户流程；自动本机导入默认关闭 |
| [OmniRoute](https://github.com/diegosouzapw/OmniRoute) | 是 | 工具已配置的 token/API key | 私有 billing API | 补充基础包/赠送包判定，MIT |
| [workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) | 是 | 自有 `auths/workbuddy-*.json` | 私有 billing API | 证明多账户积分聚合，不是零配置自动读取 |
| [TokenTracker](https://github.com/mm7894215/TokenTracker) | 否，主要是 token | Hooks + JSONL/trace | 本地会话记录 | 证明 `session_usage.used` 不是账户 Credits |
| [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) / [ping-island](https://github.com/erha19/ping-island) | 否 | Hooks | 运行事件 | 只用于桌宠工作状态，不用于积分 |

## 1. TokenBar：直接自动读本机 WorkBuddy 凭据

TokenBar 是 macOS 菜单栏/触控栏配额工具，README 明确宣称 WorkBuddy 的数据源为“Local WorkBuddy/CodeBuddy auth file and Tencent WorkBuddy billing APIs”。

- 本地凭据路径：
  - `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth`
  - 备选 `~/Library/Application Support/WorkBuddyExtension/Data/Public/auth`
- 优先文件：`workbuddy-desktop.info`
- 读取字段：`auth.accessToken`、`account.uid`、`account.enterpriseId`
- 个人账号：请求 `get-user-resource`，累加 `CycleCapacitySizePrecise` 和 `CycleCapacityRemainPrecise`。
- 企业账号：请求 `get-enterprise-user-usage`，解析 `limitNum`、`credit`和 `cycleResetTime`。
- 进度：`usedPercent = (total - left) / total * 100`。

源码证据：

- [凭据路径和读取](https://github.com/GA0LU/TokenBar/blob/e70efa00a34adc56fa7c4bc0d8a9bb15464a55e6/Sources/TokenBar/main.swift#L2012-L2122)
- [个人/企业 Credits 请求及进度映射](https://github.com/GA0LU/TokenBar/blob/e70efa00a34adc56fa7c4bc0d8a9bb15464a55e6/Sources/TokenBar/main.swift#L1906-L2010)
- [README 的 WorkBuddy 数据源说明](https://github.com/GA0LU/TokenBar/blob/e70efa00a34adc56fa7c4bc0d8a9bb15464a55e6/README.md)

TokenBar 以 MIT 许可发布，其实现机制和 Swift 数据模型对 Maclawd 参考价值最高。

## 2. Metrik：跨平台自动读取实证

Metrik 同样会自动扫描 `CodeBuddyExtension/Data/Public/auth/*.info`，并优先选择文件名包含 `workbuddy` 的凭据：

- macOS：`~/Library/Application Support/CodeBuddyExtension/Data/Public/auth`
- Windows：`%LOCALAPPDATA%/CodeBuddyExtension/Data/Public/auth`
- Linux：`~/.local/share/CodeBuddyExtension/Data/Public/auth`
- 字段：`auth.accessToken`、`auth.domain`、`account.uid`
- 仅在内存中用 token 发起一次请求，不把 token 写入数据库或错误日志。

它向 `https://{host}/v2/billing/meter/get-user-resource` 发送 Bearer token，带 `X-User-Id`/`X-Domain`，将多个 `Accounts[]` 的 `CycleCapacitySize` 和 `CycleCapacityRemain` 合并为一根 Credits 进度条，重置时间取最早 `CycleEndTime`。

源码证据：

- [私有接口请求和解析](https://github.com/keros68/metrik/blob/9f785296e5f6f99607905537beb7aeaa30cbefbc/src-tauri/src/coding_quota.rs#L438-L562)
- [本地 `.info` 凭据扫描](https://github.com/keros68/metrik/blob/9f785296e5f6f99607905537beb7aeaa30cbefbc/src-tauri/src/coding_quota.rs#L601-L686)
- [真机响应形态测试](https://github.com/keros68/metrik/blob/9f785296e5f6f99607905537beb7aeaa30cbefbc/src-tauri/src/coding_quota.rs#L1595-L1630)

Metrik 当前为 AGPL-3.0-or-later，不建议直接复制它的代码；可以将其作为独立实现的事实依据。

## 3. codex-app-transfer：积分桶解析最完整

codex-app-transfer 不是直接借用 WorkBuddy 已登录文件，而是让用户通过其自身 WorkBuddy OAuth 或 API key 配置账号。它再用 Bearer token 请求同一 `get-user-resource` 接口。

该项目的积分桶解析更适合作为 Maclawd 的数据语义参考：

- `CapacityType == 4`：基础/月度刷新包。
- 其他 `CapacityType`：赠送、活动或加量包，单独聚合。
- 金额优先读字符串精度字段 `CycleCapacityUsedPrecise` / `SizePrecise` / `RemainPrecise`。
- `remain` 缺失时用 `size - used` 降级。
- 基础包的 `CycleEndTime + 1 秒` 作为下次刷新时间。

源码证据：

- [字段、分桶和重置映射](https://github.com/Cmochance/codex-app-transfer/blob/74d79cbb99f9910caeb59b0d6615660877d16252/src-tauri/src/workbuddy_quota.rs#L1-L199)
- [请求私有 billing API](https://github.com/Cmochance/codex-app-transfer/blob/74d79cbb99f9910caeb59b0d6615660877d16252/src-tauri/src/workbuddy_quota.rs#L201-L249)
- [工具自有 WorkBuddy OAuth 流程](https://github.com/Cmochance/codex-app-transfer/blob/74d79cbb99f9910caeb59b0d6615660877d16252/crates/gemini_oauth/src/workbuddy/login.rs#L1-L18)

该项目使用 MIT 许可。对 Maclawd 而言，它适合参考积分桶和响应解析，但它的 OAuth 方案会要求用户再登录一次，不符合“安装 Maclawd 后自动读已登录 WorkBuddy”的最初体验目标。

## 4. cockpit-tools：本机导入是显式开关

cockpit-tools 同时实现了：

- 工具自有 WorkBuddy OAuth；
- 从 `CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info` 读取本机登录；
- 使用 access token 请求 `get-user-resource`；
- 带 `X-User-Id`、`X-Enterprise-Id`、`X-Tenant-Id`和 `X-Domain` 等账号上下文。

与“无感自动读取”有关的重要产品决策是：它将“本机账号自动导入”设为用户可见开关，且默认值为 `false`。这说明开源作者也将本地登录凭据扫描视为需要用户知情的敏感能力。

源码证据：

- [WorkBuddy 共享凭据路径](https://github.com/jlcodes99/cockpit-tools/blob/87242087582b83d9d0760696f6d2dbd539c408e9/src-tauri/src/modules/workbuddy_account.rs#L1035-L1083)
- [本地 access token 导入](https://github.com/jlcodes99/cockpit-tools/blob/87242087582b83d9d0760696f6d2dbd539c408e9/src-tauri/src/modules/workbuddy_account.rs#L1471-L1510)
- [`get-user-resource` 请求和身份请求头](https://github.com/jlcodes99/cockpit-tools/blob/87242087582b83d9d0760696f6d2dbd539c408e9/crates/cockpit-core/src/modules/workbuddy_oauth.rs#L548-L655)
- [本机自动导入默认关闭](https://github.com/jlcodes99/cockpit-tools/blob/87242087582b83d9d0760696f6d2dbd539c408e9/src-tauri/src/modules/config.rs#L828-L833)

cockpit-tools 默认采用 CC BY-NC-SA 4.0，禁止未授权商业集成，不应直接复制其代码到商业产品。

## 5. 积分包不应简单全部相加

OmniRoute 对同一接口做了更细的语义区分：

- 可刷新基础包使用 `CycleCapacity*` 字段；
- 一次性赠送包使用 `Capacity*` 字段；
- 通过 `CycleEndTime` 与 `DeductionEndTime` 的差异判定是周期刷新包还是到期即失效的赠送包；
- 每个包保留独立 reset/expiry，不把最早到期时间当成整个账户的单一重置时间。

参见 [OmniRoute CodeBuddy CN usage handler](https://github.com/diegosouzapw/OmniRoute/blob/2cb7567d66bde56157385122cf81503605e973d7/open-sse/services/usage/codebuddy-cn.ts)。

这也说明 Maclawd 若将 WorkBuddy 与 Claude Code/Codex 并列显示，不应只设计一个不分语义的 `used / total / resetAt`；至少要保留 `resources`/积分桶结构。

## 6. Hooks、JSONL 和 `workbuddy.db` 是另一类数据

TokenTracker 和桌宠类项目证实了三类数据的边界：

- WorkBuddy Hooks：适合会话开始、工具使用、等待、停止等桌宠状态，不含账户 Credits。
- `~/.workbuddy/projects/**/*.jsonl` / traces：是 token 和会话消耗，不是套餐剩余积分。
- `workbuddy.db.session_usage.used/size`：TokenTracker 已修正过将其误当累计 token 的旧实现；当前源码将它视为上下文窗口状态，`credit_json` 是会话/模型 credit 信息，不是账户月度余额合同。

参见：

- [TokenTracker WorkBuddy parser 对 SQLite 语义的说明](https://github.com/mm7894215/TokenTracker/blob/d0824d87d4043ee90bae39646e1426f03b559ac7/src/lib/rollout.js#L8540-L8669)
- [clawd-on-desk WorkBuddy Hook](https://github.com/rullerzhou-afk/clawd-on-desk/blob/1705317721bdc14e0c23d0051afb9c036234b3bd/hooks/workbuddy-hook.js)
- [ping-island WorkBuddy Hook 安装](https://github.com/erha19/ping-island/blob/b4d6f1ab678b1fbd5ddb1816b666f0ab641dfc23/Prototype/Sources/IslandApp/Core/HookInstaller.swift#L271-L279)

## 7. 本机 5.3.8 的只读核对

本次只读检查本机发现：

- `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth` 存在；
- 存在 `workbuddy-desktop.info` 和 `workbuddy-desktop-ai.info`；
- 两个文件都有 `auth.accessToken`、`auth.refreshToken`、`auth.domain` 和 `account.uid` 等字段；
- 未输出、记录或发送任何 token 值；未使用该 token 请求私有计费接口。

这使“用户已安装并登录 WorkBuddy 后，Maclawd 自动识别本地凭据”在当前本机环境上得到了路径和 schema 验证。

## 8. 官方合同状态

腾讯官方 CodeBuddy HTTP API 文档将对开发者的公开稳定层定义为 `/api/v1/*`，并对该层给出语义化版本承诺。上述 `/v2/billing/meter/*` 路径并不在该公开 API 合同中：[CodeBuddy Code HTTP API Beta](https://www.workbuddy.ai/docs/cli/http-api)。

因此，开源项目能成功调用，只能证明当前技术可行，不等于腾讯对第三方提供了稳定、授权的 Credits API。

## 9. 对 Maclawd 的技术判断

### 可行性

- **检测 WorkBuddy 安装：高。** 已实现。
- **已登录用户的本地凭据发现：高。** 两个开源工具和本机 5.3.8 都验证了相同路径。
- **当前版本的 Credits 读取：高。** 多个独立项目实现了相同计费请求和响应解析。
- **长期稳定性：中低。** 凭据路径、文件名、请求头、私有 endpoint 和 schema 都可随 WorkBuddy 升级变化。
- **用户新安装 Maclawd 后自动显示：技术上可行。** 前提是 WorkBuddy 已登录、凭据未过期、路径/schema 未改变且网络可访问计费服务。只安装未登录时不可读。

### 不建议的做法

- 不读取、保存或刷新 `refreshToken`。
- 不把 access token 写入 Maclawd 配置、数据库、日志或崩溃报告。
- 不在错误文本中返回完整请求头、响应或凭据路径内容。
- 不高频轮询；开源项目已用 45 秒至数分钟缓存，Maclawd 更适合 5–15 分钟刷新及手动刷新。
- 不将所有积分包的最早到期时间冒充整个账户的单一 `resetAt`。

### 产品决策建议

如果未来实现，建议采用“检测后显式开启”，而不是用户无感地使用登录 token。可向用户准确说明：

> 允许 Maclawd 读取 WorkBuddy 保存在本机的登录状态，向 WorkBuddy 查询账户积分。凭据仅在内存中用于查询，不会保存或上传给 Maclawd。该能力依赖 WorkBuddy 当前的内部数据接口，未来版本可能失效。

默认关闭、只读 access token、仅内存使用、设置严格 host allowlist、低频查询、401/403 立即降级、保留多积分桶，是目前比较稳妥的产品化边界。

## 最终判断

**现有开源项目已经证明 Maclawd 可以在用户已登录 WorkBuddy 的前提下，自动发现本地登录文件并获取真实账户 Credits。**

这不再是技术可行性疑问，而是产品和安全决策：是否愿意依赖 WorkBuddy 未公开的凭据存储和计费接口，以及是否要求用户明确开启这一能力。
