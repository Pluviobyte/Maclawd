# Usage Analytics 统计合同

Maclawd 的原生统计页与本地 Web 页的**统计数字**只消费同一个接口：
`GET /api/analytics`。Web 仍可从 `/api/summary` 读取项目路径、来源标签、回顾与设置等
非分析元数据；页面不再自行组合 Token、费用、时长与分布，避免同一指标出现不同口径。

## 聚合粒度

扫描器仍保留原有日汇总，同时写入稀疏的 30 分钟槽：

```text
slotStart × source × model × project → token bucket
```

槽位只为实际发生过用量的组合建桶。`rollup.v = 3`；读取旧版本时服务端明确返回
`stale`，下一次扫描会从原始日志重建，不静默展示零值。

当前应用只追踪本机，因而不提供没有决策价值的 hostname/terminal 筛选。数据结构可在
未来多机同步时增加该维度，而不用改变现有 Token 口径。

## Token 口径

- `inputTokens`：非缓存输入 + 5 分钟缓存写 + 1 小时缓存写
- `outputTokens`：输出中扣除单独展示的 reasoning
- `reasoningTokens`：推理 Token（已经包含在底层 output 中）
- `cachedTokens`：缓存读取
- `totalTokens`：输入、完整输出、缓存读取之和；reasoning 不重复相加
- `billableTokens`：输入、缓存写、完整输出之和；不含缓存读取

费用由当前价格表在查询时计算，不固化进 rollup。未知模型不猜价，接口同时返回
`coverage`、未计价 Token 和模型列表。

## 查询

支持 `today`、`24h`、`7d`、`30d`、`90d`、`yesterday`、`week`、
`last_week`、`month`、`year`、`all` 与 `custom&from=YYYY-MM-DD&to=YYYY-MM-DD`。
除 `all` 外，接口返回上一个等长区间及变化率。
其中 `24h` 按持久化粒度定义为“包含当前槽的最近 48 个半小时槽”，并与之前 48 槽比较；
这是诚实的槽级窗口，不使用无法从 30 分钟聚合中恢复的伪精确毫秒边界。

`source`、`model`、`project` 可重复传参，筛选同时作用于总量、费用、趋势、热力图、
分布和 30 分钟明细。会话日志没有模型归属，因此按模型筛选时 `sessions.available=false`，
界面必须明确说明，不能伪造时长。

## 返回区块

- `totals`、`previous`、`comparison`
- `cost` 与计价覆盖率
- `sessions`（会话数、活跃时长、墙钟时长、消息数、用户消息数）
- `series`（每日 Token、费用、活跃/墙钟时长）
- `heatmap`（固定 7×24 单元）
- `distributions.tools/models/projects`
- `dimensions`（筛选候选项）
- `records`（按时间倒序的 30 分钟明细，基于最后一条稳定身份的 opaque cursor 分页）

会话摘要无法从聚合结果中按分钟切割。跨越区间边界的会话完整计入相交区间，并在趋势与
热力图中归到它在当前区间内的第一个时刻；这是显式近似，三处展示保持总量一致。
