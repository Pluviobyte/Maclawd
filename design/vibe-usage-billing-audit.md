# Vibe Usage 计费与 Maclawd 准确性审计

审计时间：2026-08-03（Asia/Shanghai）
对照版本：Vibe Usage CLI `a4967515b770264d61c53cab1a29752bfb31bce6`

## 结论

修复前，Maclawd 的近 30 天统计因固定顺序扫描、Claude 去重过强和 Codex
fork/subagent 重放而严重失真。修复后，Claude 与 Codex 的本地冷扫描结果已和 Vibe
官方解析器收敛到运行中日志的时间漂移量级；面板也不再把“价格覆盖率”冒充“采集完整度”。

费用仍应称为**估算费用**：Maclawd 按 Anthropic 官方 5 分钟/1 小时缓存写入倍率计价，
而 Vibe 上传 schema 把两类 cache creation 合并进普通 input，网页后端价格实现未开源。
因此两者 Token 可以严格对照，费用不应被强行做成同一个数字。

## 修复前基线

同账户、同机器、近 30 天的旧面板只有 Claude Code，显示 2.463B Token、$2,483.29、
359 个会话；Vibe Web 当时显示 10.530B Token、$9,322.28、953 个会话。主要不是
公式误差，而是 Codex 等后置来源长期拿不到 20 秒共享扫描预算。

另外，Maclawd 曾按 `(message.id, requestId)` 折叠 Claude 记录。真实日志中同一组
message/request 常有不同 UUID，这一规则使 Claude 冷扫描比官方解析器少约 55.4%。
Codex 则因 fork/subagent 重放前缀多计约 4.8%。

## 修复后差分

下表来自全新临时缓存的近 30 天冷扫描。官方与 Maclawd 是相邻运行，期间活跃日志仍在
追加，因此差值只能解释为上界，不能视为静态快照的纯解析误差。

| 来源/指标 | Vibe 官方解析器 | Maclawd | 相对差异 |
|---|---:|---:|---:|
| Claude 总 Token | 5,565,998,982 | 5,566,131,728 | +0.0024% |
| Codex 总 Token（含 reasoning） | 7,254,864,915 | 7,256,036,943 | +0.0162% |
| Codex 会话数 | 654 | 654 | 0% |
| Codex 活跃秒数 | 21,887,700 | 21,883,441 | -0.0195% |
| Codex 消息数 | 319,311 | 317,862 | -0.45% |

Codex 消息数的剩余小差异来自 fork 边界处元事件的归属，不影响 Token、会话数或费用；
Maclawd 已在“外部 session id 后本 session id 再现”的边界清除父会话消息重放。

## 已实施修复

1. 扫描器持久化下一个 deferred 来源并轮转起点；每个来源暴露发现、已索引、待处理、
   失败文件数和最新记录时间。默认 20 秒预算下，实机冷建第二轮即可完成全部来源。
2. Claude 以 UUID 为主键去重，同 UUID 冲突保留用量更完整的记录；同时发现 Claude
   Desktop Cowork 的私有 `.claude/projects` roots。
3. Codex 识别 fork/subagent 自有任务边界，丢弃父历史 Token 与消息重放；会话时长采用
   与 Vibe 一致的“首个回复到本轮最后回复”算法。
4. rollup、summary API、分析页和原生面板携带采集完整度。索引未完成时总量显示 `≥`，
   并明确提示剩余文件，避免把部分结果展示成确定总数。
5. `billableTokens` 的用户文案改为“非缓存读取 Token”。缓存读取仍会计费，旧名称会让
   用户误以为缓存不是 billable；API 暂保留旧字段作为兼容别名。
6. Anthropic 已知模型优先使用官方价格和 TTL 缓存倍率；用户 override 仍拥有最高优先级，
   OpenRouter 仅补充其他模型。价格覆盖率与来源采集完整度分开显示。

## 数据源边界

- Cursor Cloud 保持显式 opt-in；未开启时不会绕过隐私设置抓取云端数据。
- 这台机器当前没有 Kiro CLI 会话流或可用的增量 credit 记录，Vibe 官方 Kiro 解析器
  本机运行同样返回空结果。网页历史 Kiro 数据不能从现存文件重建。
- Kiro CLI 日志本身不含 Token，Vibe 采用字符数除以 4 的估算。Maclawd 不把这类估算
  混入精确 Token；若未来支持，必须作为明确标注的估算来源展示。
- Kimi/Qwen 等无法匹配价格的模型仍计入 Token，但费用为未知；不会用零价格伪装完整。

## 主要依据

- Vibe Usage upstream：src/parsers/claude-code.js、src/parsers/codex.js、
  src/parsers/kiro.js、src/parsers/index.js、src/sync.js
- Vibe Usage macOS app `7537abbd3378144b7c6dd36211cc9e23e7f74668`：
  `VibeUsage/Models/UsageBucket.swift`
- Anthropic Claude Platform pricing 与 prompt caching 文档
