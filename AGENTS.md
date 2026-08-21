# 用量与额度实现参考约定

涉及 Token 用量、订阅额度、计费周期、重置时间、费用估算、本地日志扫描或供应商凭据时，必须先研究相关上游的**最新代码**，不能只依赖仓库内旧审计或模型记忆。

## 参考优先级

1. 供应商官方源码、协议、SDK 与文档。官方字段语义和稳定接口优先于第三方实现；例如 Codex 优先核对 `openai/codex` 的 app-server 协议。
2. [`robinebers/openusage`](https://github.com/robinebers/openusage)：账户额度、计费周期、重置时间、本地凭据发现、刷新重试、套餐差异和多供应商降级策略的首要第三方参考。
3. [`vibe-cafe/vibe-usage`](https://github.com/vibe-cafe/vibe-usage) 与 [`vibe-cafe/vibe-usage-app`](https://github.com/vibe-cafe/vibe-usage-app)：本地会话日志解析、Token 口径、去重、增量尾读、缓存、扫描调度、分析聚合和 macOS 运行方式的首要第三方参考。
4. [`deviffyy/OpenQuota`](https://github.com/deviffyy/OpenQuota)：跨平台、多供应商额度与重置时间的补充实现，用于交叉验证 OpenUsage 未覆盖或平台行为不同的分支。
5. [`steipete/CodexBar`](https://github.com/steipete/CodexBar)：macOS 菜单栏、多账户、凭据发现、供应商适配和额度展示的补充参考。
6. [`ccusage/ccusage`](https://github.com/ccusage/ccusage)：Claude Code、Codex 及其他 Agent 的本地 JSONL 解析、缓存 Token 拆分、成本和日/周/月聚合的补充参考。
7. [`GA0LU/TokenBar`](https://github.com/GA0LU/TokenBar)：WorkBuddy/CodeBuddy 本地凭据发现、个人/企业计费接口和积分桶映射的专项参考。

可按具体供应商增加其他活跃、可验证的开源项目，但不要因为项目支持的供应商多就默认其字段语义正确。

## 每次研究与实现的要求

- 开始实现前联网检查上述相关仓库的最新默认分支、最新稳定 release、近期修复和已知 issue；不要照搬本仓库文档里固定到旧 commit 的结论。
- 在研究记录、提交说明或测试注释中写明实际核对的仓库与 commit/tag。若最新默认分支与稳定 release 行为不同，明确选择理由。
- 未公开接口、Cookie/Token 组合、字段单位和套餐分支至少用两个独立实现交叉验证；能用本机真实响应脱敏验证时，再补一层真机验证。
- 区分“本地 Token/费用统计”和“服务端订阅额度/限流百分比”，不得互相推算或混为同一口径。
- 优先复用供应商官方进程或本机已有登录状态；凭据只发送给对应供应商域名，不记录、不输出、不上传。
- 将第三方实现视为证据和设计参考，不复制不兼容许可证的代码、资源或品牌资产；最终实现应符合 Maclawd 自己的数据契约和隐私边界。
- 为现代路径、token 刷新、套餐差异、降级路径、错误分类和 UI 顺序分别补测试；可行时执行一次不输出凭据的真实请求验证。
- 如果多个参考实现冲突，以官方行为和真实响应为准，并在结论中说明冲突与取舍。
