# Kimi / 豆包工作上游适配研究（2026-09-10）

> 后续已完成本机接入；“未验证后台 HTTP”等描述保留研究当时状态，最终结果见 [接入记录](kimi-doubao-quota-integration.md)。

本记录是实际联网检查最新默认分支、稳定 release、近期 issues 后的结论；只研究，未改产品代码。所有第三方代码仅用于证据和设计参考。真实本机验证由主任务独立完成，本研究没有读取本机凭据。

## 结论

- **Kimi 已有多套开源适配**：官方 Kimi Code 支持服务端 Code 额度和标准本地 token 日志；CodexBar、OpenQuota 等支持 Code 用量；CodexBar、Foundry Quota Sentinel、AACC 支持独立会员月度共享额度。能够添加，但须分别建模会员月额度、Code 限流窗口、本地 token，不能混成一个数。
- **豆包工作尚未在检索范围找到成熟额度适配**。CodexBar 名称叫 Doubao 的 provider 实际是火山 Ark Coding/Agent Plan 或 API rate-limit probe，与豆包工作消费者/企业账号不是同一产品。GitHub 代码搜索精确 `"/alice/commerce/sale/subscription/quota/summary/"` 和 `"DoubaoWork" "quota"` 均为 0 结果。它的可行性证据来自本机官方 bundle 和已登录客户端界面，见下文。
- **当前机器的认证差异明确**：CLI 旧凭据已过期，真实只读 usage 请求为 401；Kimi Desktop 3.2.5 初始化后恢复已有登录，官方会员界面可读 Free、总使用量 0%、2026-09-12 后重置。已验证官方 UI 数值，尚未验证独立 HTTP 响应。豆包工作界面也已有可读 5 小时/7 天额度。CLI 401 不能解释为整个 Kimi 账号未登录。

## 实際核对的仓库版本

| 仓库 | 最新默认分支 / commit | 最新稳定 release（UTC） | 许可证 |
|---|---|---|---|
| `AlephAITech/DoubaoWorkGuide` | `main` / `ad7338e8fc889ec082cdfb3fa41fb659520c7174` | `无稳定 release` (—) | MIT |
| `GA0LU/TokenBar` | `main` / `937a68645f130230e934c15bc6112a0b2103048a` | `v1.0.0` (2026-08-30T22:07:22Z) | MIT |
| `MoonshotAI/kimi-cli` | `main` / `86f136422a0aae6b217ea49e7ea1d2e8a1defcd2` | `1.50.0` (2026-09-01T16:53:20Z) | Apache-2.0 |
| `MoonshotAI/kimi-code` | `main` / `2da4aa23b0d484312cc068b2d4b2a62e694a2bfe` | `@moonshot-ai/kimi-code@0.42.0` (2026-09-09T06:24:42Z) | MIT |
| `RainbowXie/foundry-quota-sentinel` | `master` / `b883a78e55c39205b0f8aab1f1d2a7ff6c43d938` | `v0.11.2` (2026-09-02T04:59:00Z) | MIT |
| `Zhen-WushuiLingchun/codex_token_visualization` | `main` / `d0ff7868313154f4bf14a695fd09329710327e5b` | `无稳定 release` (—) | 未发现明确许可证 |
| `ccusage/ccusage` | `main` / `c9fab03cc510e717f0dba50f4a6a4940da1c09cb` | `v20.0.20` (2026-08-15T12:28:12Z) | NOASSERTION |
| `chendefine/dsh-plugins-plan-usage` | `main` / `3f10cc7227fb2150fcea466cf7f36f20b91ec5bf` | `无稳定 release` (—) | MIT |
| `deviffyy/OpenQuota` | `main` / `0b21b354e1a0a3f65d78900ec244c43f581542e2` | `v0.5.0` (2026-08-24T05:52:06Z) | MIT |
| `margrop/coding-plan-dashboard` | `main` / `89476af58b35e7dff467029da7bc2dc3e6057c5d` | `v1.0.0` (2026-07-25T10:41:55Z) | MIT |
| `robinebers/openusage` | `main` / `70dea9a8fa21ed205aa9ad625b416a1e7792d5a1` | `v0.7.11` (2026-09-05T12:32:10Z) | MIT |
| `steipete/CodexBar` | `main` / `5c0d7b4f87d64dfde01043955cce73f78f6b5ecb` | `v0.58.0` (2026-09-10T04:06:38Z) | MIT |
| `vibe-cafe/vibe-usage-app` | `main` / `34d50754e0504b4a33b87d1f7927d462f30cb98e` | `v0.5.10` (2026-09-03T05:06:59Z) | 未发现明确许可证 |
| `vibe-cafe/vibe-usage` | `main` / `850f27dcf1db511b8c48a7ec93a27f77d1b35437` | `v0.10.21` (2026-09-03T05:14:54Z) | 未发现明确许可证 |
| `zhangboqian2022/AI-Agent-Control-Center` | `main` / `414267fcb945b9464922d517baf876426ebae73b` | `v1.4.5` (2026-08-29T13:12:23Z) | MIT |

使用 GitHub REST repo / commit / latest release / issues / compare，并 shallow clone 最新默认分支核对源码。GitHub LICENSE 元数据 null 不代表可任意复制；对未明确许可项目只引用观察，不移植代码。ccusage API 返回 NOASSERTION，须逐文件确认许可证，不能凭工具名称假设 MIT。

### 默认分支与 release 差异

- CodexBar v0.58.0 `88fa2f45fa1e7e04c3c96234ddf973ca947208db` 到研究 main 仅 2 commits，Kimi/Doubao 文件未变化，可按稳定版对应实现理解。
- OpenQuota v0.5.0 到 main 7 commits，Kimi 文件未变化；vibe-usage v0.10.21 到 main 28 commits，Kimi parser 文件未变化。
- Kimi Code 0.42.0 `6954d2c8bf94a5c7fc29cc6ae35b15d042cc4dcb` 到 main 10 commits。采用最新 main 为协议研究基准；主任务若实现应再按安装版本匹配 wire 协议，而非假定旧 kimi-cli Python 1.x 仍是当前主实现。
- AACC v1.4.5 到 main 23 commits，有 Kimi web login state 修复。Foundry v0.11.2 到 master 4 commits，其中大量 Kimi provider/auth 文件变化，**这里引用 master 的 Kimi，不将其宣称为 v0.11.2 已发布功能**。
- ccusage v20.0.20 到 main 213 commits，Kimi Rust parser 有变化。最新 parser 仍存在下面指出的 scope 口径冲突，因此不按其注释实现。

## Kimi：三种独立数据面

### 1. Code 订阅窗口（官方）

当前官方主项目为 [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code)，旧 kimi-cli README 明确推荐迁移。官方源码：

- [managed-usage.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/managed-usage.ts)：中国 `GET https://api.kimi.com/coding/v1/usages`，国际 `https://api.kimi.ai/coding/v1/usages`，Bearer auth。必须用对应地区签发凭据，不能遇到失败就跨域轮询。
- `usage.used` / `usage.limit` 数字字符串；`resetTime` ISO 时间；官方在 `usage` 没有 window 时设定 1 week。`limits[]` 自带 `window.duration` 和 `timeUnit`（MINUTE/HOUR/DAY/WEEK），300 分钟即 5h。**不可假定一定返回 5h，亦不可用数组第一项就当 5h**。官方 parser 保留所有可用 limits。
- 百分比由 used / limit × 100；这些是服务端额度单位，不是本地 token。仅已确认 quota 对象可使用 proto 默认零；缺少整个对象应显示不可用，不伪造 0%。
- `boosterWallet` 是额外消费钱包，官方明确 `balance.amount` / `amountLeft` 固定点除以 1,000,000 得分（cents），`monthlyChargeLimit.priceInCents` / `monthlyUsed.priceInCents` 原本已是分。该钱包仍非本地成本统计，本阶段可以不做。

交叉验证：[OpenQuota client](https://github.com/deviffyy/OpenQuota/blob/0b21b354e1a0a3f65d78900ec244c43f581542e2/src-tauri/src/providers/kimi/client.rs)、[OpenQuota mapper](https://github.com/deviffyy/OpenQuota/blob/0b21b354e1a0a3f65d78900ec244c43f581542e2/src-tauri/src/providers/kimi/mapper.rs)、[CodexBar fetcher](https://github.com/steipete/CodexBar/blob/5c0d7b4f87d64dfde01043955cce73f78f6b5ecb/Sources/CodexBarCore/Providers/Kimi/KimiUsageFetcher.swift)。OpenQuota 按精确窗口长度找 5h 优于 CodexBar 取 first 的分支；不直接复制任一实现的所有宽松默认值。

### 2. Kimi 会员月度共享额度（Web / Desktop）

内部 Connect RPC：

```text
POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats
Content-Type: application/json
Connect-Protocol-Version: 1
Authorization: Bearer <consumer-account-access-token>
body: {}
```

- `subscriptionBalance.amountUsedRatio`：总已用比例 **0..1**。
- `subscriptionBalance.kimiCodeUsedRatio`：其中 Code 的份额 **0..1**；非 Code 份额可在两个有效且相容时相减，不能从 Code 周额度推算。
- `subscriptionBalance.expireTime`：服务端 RFC3339 周期结束时间，应精确显示；不要擅自归到下月 1 日或硬设 30 天。
- 本机 Free 套餐官方 UI 显示总使用量和指定日期后重置；免费/试用总池不应无条件标为月度，应按响应周期呈现。本文“月度共享额度”描述主要付费适配，不是所有套餐的固定周期保证。
- `ratelimitCode5h` / `ratelimitCode7d`：Code 独立窗口，`ratio` 0..1、`resetTime`、`enabled`；`ratelimit5h` / `ratelimit7d` 是非 Code 相关窗口线索，按实际响应及官方 UI 确认后再展示。
- 可选同服务 `GetSubscription` 查询套餐名。失败不应抹除已成功取得的额度。
- 旧 fallback `POST /apiv2/kimi.gateway.billing.v1.BillingService/GetUsages` body `{"scope":["FEATURE_CODING"]}`，只用于 web Code 用量；它不代替月度共享池。

两个独立实现已一致确认月度端点、字段及单位：

1. [CodexBar KimiUsageFetcher](https://github.com/steipete/CodexBar/blob/5c0d7b4f87d64dfde01043955cce73f78f6b5ecb/Sources/CodexBarCore/Providers/Kimi/KimiUsageFetcher.swift) 和同目录 KimiUsageSnapshot；Bearer 与 kimi-auth Cookie 同传，并补充设备和 session headers。
2. [Foundry client](https://github.com/RainbowXie/foundry-quota-sentinel/blob/b883a78e55c39205b0f8aab1f1d2a7ff6c43d938/pkg/sdk/providers/kimi/client.go) / [parser](https://github.com/RainbowXie/foundry-quota-sentinel/blob/b883a78e55c39205b0f8aab1f1d2a7ff6c43d938/pkg/sdk/providers/kimi/parser.go)：仅固定 www.kimi.com，拒绝 redirect；明确 ratio×100，纳秒 RFC3339 时间。其“必须同时具备三个窗口”限制不宜照搬，应允许套餐少返回某窗口。
3. [AACC same-origin query](https://github.com/zhangboqian2022/AI-Agent-Control-Center/blob/414267fcb945b9464922d517baf876426ebae73b/src/aacc/kimi_membership_query.py)：在已登录 WebView 中读取 access_token，仅把脱敏 quota 返回宿主，401 后让页面自身更新登录状态。其“<=1 乘100、>1 当百分比”启发式过宽，不如按明确字段单位解析。

这些内部端点没有公开稳定协议保证。官方前端/本机真实响应优先于第三方推断。`totalQuota` 不能当稳定月额度来源：官方当前 managed parser不使用它，部分第三方历史实现将其视为月度；本任务应优先独立 MembershipService。

### 3. 本地 token 日志（官方 + 本地统计项目）

- 现代 `$KIMI_CODE_HOME`，默认 `~/.kimi-code`；目录 `sessions/wd_<slug>_<hash>/session_<id>/agents/<agent>/wire.jsonl`；`session_index.jsonl` 关联 workDir。旧 `~/.kimi/sessions/<workdir-hash>/<session>/wire.jsonl` 格式为 StatusUpdate/token_usage、秒级 timestamp，不可混解析。
- 现代 `usage.record` 含 `usage.inputOther`、`output`、`inputCacheRead`、`inputCacheCreation`；`time` 是毫秒。四种 token 应独立保存；成本与订阅额度分离。model 可能是别名或 secondary model，成本未知时保留未知，避免错用价格。
- **scope 冲突已由官方裁决**：[官方 usageAgentModel.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/agent-core-v2/src/session/usage/usageAgentModel.ts) 对每个 UsageRecord 执行 addUsage；record 将 source 非 turn 标为 session，传入仍为本次调用 usage，因此 session scope 不是天然累计总额。[vibe-usage 当前 parser](https://github.com/vibe-cafe/vibe-usage/blob/850f27dcf1db511b8c48a7ec93a27f77d1b35437/src/parsers/kimi-code.js) 同时计入两种 scope，与官方一致；[ccusage 最新 Rust parser](https://github.com/ccusage/ccusage/blob/c9fab03cc510e717f0dba50f4a6a4940da1c09cb/rust/adapters/kimi/src/parser.rs) “session cumulative totals”注释却排除 session，这一点不能照抄。
- 双目录、session 与 agent ID 组合及事件身份去重；不能只按 timestamp+token 数合并不同 agent 的真实并发调用。先按 wire 版本及事件结构区分 delta/summary，避免笼统 scope 过滤。
- Kimi Desktop 另有内嵌 runtime。社区 Windows 路径 `%APPDATA%/kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/sessions`，见 [registry](https://github.com/Zhen-WushuiLingchun/codex_token_visualization/blob/d0ff7868313154f4bf14a695fd09329710327e5b/providers/registry.js)。macOS 要按本机布局验证，不能只移植 Windows APPDATA。

本机仓库核验补充：Maclawd 已有 `src/runtime/parsers/kimi-code.js`，主任务以本地全部 1,582 个 usage.record 实测 parseObject 全部接受（包括 session）。因此 Kimi 本次主要缺口是账户额度接入，不能表述为从零新增 token 支持。具体本机证据见 [本机可行性记录](kimi-doubao-local-feasibility-2026-09-10.md)。

## 认证发现与刷新

### CLI 官方路径

[storage.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/storage.ts)、[types.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/types.ts)、[toolkit.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/toolkit.ts)：默认 `~/.kimi-code/credentials/kimi-code.json`，`access_token` / `refresh_token` / `expires_at`（Unix 秒），0600。还有按环境隔离的 `oauth/kimi-code-env-*` slot，不能只检查一个默认文件就断言未登录。

[oauth.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/oauth.ts)：设备认证 `/api/oauth/device_authorization`；登录/刷新 `/api/oauth/token`，form-urlencoded，刷新 `grant_type=refresh_token`、`client_id`、`refresh_token`；host 与地区配置绑定。中国 OAuth host `https://auth.kimi.com`，国际 host 由 [region.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/region.ts) 选择，不跨地区发送。

[oauth-manager.ts](https://github.com/MoonshotAI/kimi-code/blob/2da4aa23b0d484312cc068b2d4b2a62e694a2bfe/packages/oauth/src/oauth-manager.ts)：懒刷新、动态到期阈值、进程内合并及跨进程锁，刷新前重新读磁盘；401/403 时检查是否其他进程已轮换，再恢复。Maclawd 优先官方进程刷新或只读已有 fresh token；不能自行无锁改写轮换凭据。CodexBar 采用只读 CLI access token，过期回登录。**本次研究无需也未执行刷新/改写。**

### Desktop / Web

[CodexBar KimiDesktopAuthToken](https://github.com/steipete/CodexBar/blob/5c0d7b4f87d64dfde01043955cce73f78f6b5ecb/Sources/CodexBarCore/Providers/Kimi/KimiDesktopAuthToken.swift) 查 `~/Library/Application Support/kimi-desktop/Cookies` 的 kimi-auth，SQLite 正常只读读取活跃 WAL、无 sidecar 时才 immutable fallback。但主任务初次在本机 Desktop 3.2.5 检查 Cookies 没有 kimi-auth，`bridge-store/token-store.json` 为 `{encryption,data}` safeStorage 加密；UI 初始化后恢复了已有登录，不能将初始化时的登录按钮当成最终状态。**Cookie 方案是否覆盖当前已登录版本需独立验证，不能凭初次 Cookie 缺失判断整个账号未登录。**

[社区桌面脚本](https://github.com/Zhen-WushuiLingchun/codex_token_visualization/blob/d0ff7868313154f4bf14a695fd09329710327e5b/scripts/sync-account-quotas.mjs) 直接读 token-store.tokens.access_token（Windows 明文布局），不适用于当前本机加密格式。AACC 的独立 WebView 登录与官方 SPA 自行刷新可作为不读取加密存储的可行降级。

补充最终本机复验：官方会员页已显示额度后，同一 Cookies 数据库依然没有 kimi-auth。因此当前本机能明确区分“有可复用开源协议参考”和“复制该参考即可自动读取本机登录”；后者尚不成立，需验证新版桌面认证桥接。

Foundry 另有 `POST https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken` body `{"refresh_token":...}` 返回 accessToken/refreshToken 的消费者账号刷新；它与 CLI `/api/oauth/token` 不是同一流。本次只确认一套独立直接刷新实现，不能当已完成双源验证并直接移植；优先官方现有登录态或页面自己刷新。

## 豆包工作：检索边界与本机可行性证据

搜索范围包括以上首选仓库源码、GitHub repository/code 搜索及 Web 检索：DoubaoWork、豆包工作、Doubao quota、精确 quota endpoint。找到 DoubaoWorkGuide、skill manager、主题工具和教程，未找到可复用的豆包工作额度 adapter；这表示“本轮未找到”，不是证明全网不存在。

[CodexBar Doubao 文档](https://github.com/steipete/CodexBar/blob/5c0d7b4f87d64dfde01043955cce73f78f6b5ecb/docs/doubao.md) 使用官方 arkcli 或火山 AK/SK 和 API probe，不能用它声明已支持豆包工作。OpenUsage、OpenQuota、vibe-usage、TokenBar 的本轮源码扫描没有豆包工作 adapter。

主任务本机官方 DoubaoWork 2.28.12 bundle / 日志明确：

```text
POST https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/
body: {"product_line":"membership"}
window_type: H5=1, D7=2, SubscriptionTotal=3, M1=4
used_percent: 0..100
end_time: milliseconds
sections: window_limit_section / enterprise_window_limit_section / quota_package_section
```

真实 UI：当前时段未消耗、开始使用后计时；近7天已用1%，9月16日22:52重置；个人标准赠送套餐。读取账户 quota 不需要制造一次模型调用；本地日志 token 即使能解析，也不能推算该订阅百分比。

请求有 `a_bogus` / `msToken` 签名，说明不能仅抄 endpoint+Cookie 宣称 HTTP 适配已完成。实现下一步应复用官方客户端已签名的只读请求/页面，或研究其稳定 IPC/请求封装；严格限制 www.doubao.com，个人/企业身份分开解析。此处尚无第二个独立开源实现交叉验证，当前支撑为“官方本机源码 + 真实已登录 UI”；尚未完成独立 HTTP 响应验证，不应标成已稳定接入。

## 近期修复与未决问题

- [OpenUsage #791](https://github.com/robinebers/openusage/issues/791)、[#1189](https://github.com/robinebers/openusage/issues/1189)：原生 0.7 系列 Kimi provider 恢复/接入请求；当前源码只有模型价格等零星匹配，不能把旧版支持表当现在已有 adapter。
- [vibe-usage #85](https://github.com/vibe-cafe/vibe-usage/issues/85)：Kimi Work/Desktop 新日志根目录支持请求，9月8日更新；[#78](https://github.com/vibe-cafe/vibe-usage/issues/78) secondary model alias，[#37](https://github.com/vibe-cafe/vibe-usage/issues/37) highspeed 3x 价格；都提示日志发现与成本不是只读四个数就结束。
- CodexBar changelog #2351 加入 Kimi Desktop 月度 补充查询，#2741 根据相同百分比和 reset 去掉重复 Code 7d 行，#3414 自动 web session 被拒绝后继续恢复，optional plan 超时不丢已有额度。这些是可借鉴的降级和 UI 测试案例。
- [Kimi Code #3591](https://github.com/MoonshotAI/kimi-code/issues/3591) Open Platform key 错写 managed provider，[#3336](https://github.com/MoonshotAI/kimi-code/issues/3336) 环境隔离 OAuth slot，进一步说明地区、来源和 API 产品边界要严谨。
- [ccusage #1357](https://github.com/ccusage/ccusage/issues/1357)、[#1246](https://github.com/ccusage/ccusage/issues/1246)：现代 ~/.kimi-code 识别；但最新实现的 scope 过滤仍与官方冲突。

## 实现前验收点

1. Kimi 分别验证 CLI fresh/expired/隔离目录、Desktop 已登录/未登录/加密格式、Web fallback；授权状态不互相遮挡。
2. 同时提供 Code 与会员池时分开展示来源和 reset；去重需同 scope、百分比和 reset 都相同，不能把不同 scope 的同值误删。
3. 新 wire 同时计 turn/session delta，主代理/子代理、多根、旧格式、损坏末行、无有效时间、重复读取、文件轮转分别覆盖；增量扫描保持低负载。
4. 豆包工作覆盖个人/企业/赠送套餐、尚未开始5h窗口、不同window_type、过期/错误响应、签名不可用的降级。只在真实响应验证后宣称服务端自动接入完成。
5. 接口缺失留空/明确不可用；不硬编码套餐价格、周请求数、月初重置，不拿 API 余额或本地 token 反算订阅。
