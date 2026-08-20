# Grok Build 额度重置时间调研

**日期：** 2026-08-20  
**结论：** Grok 服务端已返回精确的周期开始与结束时间。Maclawd 没有显示重置倒计，不是上游缺字段，而是当前 protobuf 通用扫描器误把“周期开始”当成了“周期结束”，随后又因该时间已过去而将其清空。

## 一手资料

1. xAI 官方 Grok Build 源码的 billing 扩展使用
   `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`，并将
   `config.currentPeriod.start/end` 定义为 RFC 3339 周期时间。兼容旧形状时
   读取 `billingPeriodStart/billingPeriodEnd`。
   [xai-org/grok-build billing.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs)
2. xAI 官方 FAQ 说明，付费 Grok 产品共用一个每周额度池，并在
   Settings → Usage 中展示精确的每周重置日期和时间。
   [SpaceXAI FAQ: Usage & Limits](https://docs.x.ai/grok/faq)
3. xAI 官方 Grok Build 文档确认 `/usage` 是查看 credit usage / billing 的内建命令。
   [SpaceXAI Docs: Modes and Commands](https://docs.x.ai/build/modes-and-commands)

## 开源实现对照

- [CodexBar Grok provider](https://github.com/steipete/CodexBar/blob/main/docs/grok.md)：
  从 Grok billing gRPC-web 响应中读取 used percent 和 reset timestamp，并将结束时间映射为 `resetsAt`。
- [cc-switch subscription_grok.rs](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/subscription_grok.rs)：
  优先选取 protobuf 路径 `[1,5,1]`；若契约漂移，则从合理范围内选取最近的未来时间，而不是第一个时间。
- [supergrok-usage-extension](https://github.com/bubbabright/supergrok-usage-extension)：
  记录了同一 gRPC 响应的 period end 路径 `1.5.1`。
- [groktok](https://github.com/danecwalker/groktok)：
  通过 `billing?format=credits` 返回 weekly `start` / `end` 与 `resets_in_seconds`。
- [grok-build-usage](https://github.com/vbusnita/grok-build-usage)：
  使用 Grok CLI OIDC 登录态请求同一 JSON billing 端点，展示周期与 reset time。

## 本机脱敏实测

使用本机 `~/.grok/auth.json` 的已登录 OIDC 凭据，仅输出计费字段，未输出 Token 或账号信息：

- 官方 JSON 端点返回 HTTP 200。
- `config.creditUsagePercent` 与 Maclawd 当前显示的百分比一致。
- `config.currentPeriod.type` 为 `USAGE_PERIOD_TYPE_WEEKLY`。
- `config.currentPeriod.start/end` 都是有效 RFC 3339 绝对时间。
- 同一账号的 gRPC protobuf 字段树为：

| 路径 | 含义 |
| --- | --- |
| `1.1` | 共享额度已用百分比（fixed32） |
| `1.4.1` | 周期开始 Unix 秒 |
| `1.5.1` | 周期结束 Unix 秒 |
| `1.8.1` | 周期类型 |
| `1.8.2.1` | typed period 开始 Unix 秒 |
| `1.8.3.1` | typed period 结束 Unix 秒 |

本机 `~/.grok/logs/unified.jsonl` 也已有 Grok Build 官方写入的
`billing: fetched credits config` 记录，其 `currentPeriod.end` 与网络响应一致。它可作离线降级数据，但不应取代主动刷新，因为日志可能过期。

## Maclawd 当前根因

`src/runtime/grok-quota.js` 的 `parseGrpcBillingResponse()` 递归扫描所有 varint，但只保留第一个像 Unix 秒的值：

1. 先遇到 `1.4.1` 的周期开始时间。
2. 将它误存为 `resetsAt`。
3. `readGrokBilling()` 发现这个时间早于现在，把它改为 `null`。
4. 界面因此无法显示重置倒计。

## 推荐实现

### 1. 主路径改用官方 Grok Build JSON billing 形状

请求：

```text
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
Authorization: Bearer <auth.json key>
X-XAI-Token-Auth: xai-grok-cli
x-userid: <auth.json user_id>
x-grok-client-version: <Maclawd version>
x-grok-client-mode: interactive
Accept: application/json
```

解析顺序：

```js
usedPercent = config.creditUsagePercent
resetText = config.currentPeriod?.end ?? config.billingPeriodEnd
resetAt = Date.parse(resetText)
```

只接受有限、可解析、晚于当前时间的 `resetAt`。不根据“每周”硬编码推算，因为每个账号的周期锚点可不同。

### 2. 保留 gRPC 作兼容回退，但改成路径感知解析

- 百分比优先 `1.1`，避免在总百分比为 0 而被 proto3 省略时，误把某个产品百分比当成总额度。
- 重置时间优先 `1.5.1`，其次 `1.8.3.1`。
- 若已知路径都不存在，只从合理范围内选最近的未来时间，不取第一个 epoch。
- 支持 gRPC-web 多帧和 trailer；非 0 `grpc-status` 不当成成功。

### 3. 可选的离线降级

网络失败时，可读取 `~/.grok/logs/unified.jsonl` 最新的
`billing: fetched credits config` 记录。必须将日志时间映射到现有 `quiet` 语义，不得把历史值伪装成实时数据。

## 需要的回归测试

1. 同时存在过去的 start 和未来的 end 时，必须选 end。
2. 精确路径 `1.5.1` 优先于其它未来 epoch。
3. 支持 typed period 结束路径 `1.8.3.1`。
4. JSON 主路径解析 `currentPeriod.end`。
5. JSON 旧形状回退至 `billingPeriodEnd`。
6. 无效日期、过去日期和超出合理范围的日期不进入额度快照。
7. 总使用率为 0 且 protobuf 省略 fixed32 字段时，在确认存在当前周期后解析为 0，不误取 product usage。
8. JSON 主路径失败后仍可通过 gRPC 回退取得额度。

## 最小落地范围

只需修改 `src/runtime/grok-quota.js` 及 `test/grok-quota.test.js`。现有额度数据契约已包含 `resetAt`，Swift 的 `QuotaRow` 也已会在它非空时显示“N 小时后重置”，因此不需要再改 UI 层。
