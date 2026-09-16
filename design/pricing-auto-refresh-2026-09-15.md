# 价格表自动刷新

## 核对来源（2026-09-15）

- `openai/codex` 默认分支 main：`fc269b66adc37f3c855df222ad80b02733355c46`；最新稳定 release `rust-v0.154.0`。此前同会话已核对 `4e6450bbfd60bdfa845182f30aaa9d6f068e8bbd` 的 `codex-rs/protocol/src/protocol.rs`：TokenUsage 是用量字段，不是美元账单。最新提交涉及 daemon 替换与 fork 附件，不改变本次刷新调度。
- `ccusage/ccusage` main：`62b3541c6804574909b9e3ee8c91ab42f83628d0`；稳定 release `v20.0.20`。核对最新 `rust/crates/ccusage-core/src/pricing.rs` 的公开价表缓存、失败重试退避，以及避免内置旧价覆盖新快照的注释。近期提交持续更新价格快照；Astra Fast 倍率相关 issue #1704、#1705 提醒估算不能等同实际扣费。使用最新默认分支作为设计参考，不移植稳定版或 Rust 实现。
- `vibe-cafe/vibe-usage` main：`fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`；稳定 release `v0.10.21`。已核对最新 [上游 Codex 解析器](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/codex.js) 的 Token 计数；近期模型价表缺口 issue 也说明新模型需要及时同步。此次不修改本地日志解析。
- 公开价格目录：<https://openrouter.ai/api/v1/models>。本会话真实 GET 已返回 `openai/gpt-6-astra`；输入、缓存读、输出的标准每百万 Token 单价分别为 $10、$1、$50，与 <https://developers.openai.com/api/docs/models/gpt-6-astra> 核对一致。

## 原因与实现

本机缓存停在 2026-08-05，缺少 Astra；用量正常但 cost=null。原实现仅允许按钮手动刷新。

新增独立后台调度器：生产服务启动即检查，每分钟检查一次缓存年龄，缺表或超过 24 小时刷新。统计查询发现真实未计价模型时异步检查；自动请求全局至少间隔 1 小时，失败保留旧表。手动刷新绕过冷却并共享进行中的请求。服务关闭时取消请求与定时器。测试直接构造服务时不启动调度器，启动服务测试明确禁用公开网络刷新。

只下载完整公开目录，不携带本地模型列表、日志、用量或供应商凭据。不改变价格优先级、个人覆盖表或 Token 口径。后台更新后下一次统计请求直接按新表计算已有用量，不需要重扫。

设置页说明自动更新周期、OpenRouter 来源与隐私边界，并显示上次成功更新时间。未成功更新时如实显示无更新时间。

## 范围限制

费用继续是标准单价估算。本次不增加 Fast、长上下文或订阅账单结算口径，也不把服务端额度百分比换算为费用。

## 验证

离线测试覆盖启动缺表/新鲜表、24 小时过期、新模型触发、伪模型排除、全局限频、失败退避、手动重试、并发合并及停机取消；价表写入测试继续验证失败保留原价表和 overrides 不变。原生编译检查设置页及时间解码。

仅包含本次变更的暂存区快照已独立通过 Swift 构建与 62 项相关测试；本机 release 构建、打包和签名校验通过。
