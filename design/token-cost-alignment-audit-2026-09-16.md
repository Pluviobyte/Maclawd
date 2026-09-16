# Token 统计与费用计算对齐审计

日期：2026-09-16，Asia/Shanghai。Maclawd：`f4be0aa6522d24ec023ddf5d13a1cb837ebb3b46`。本记录保留实施前审计；后续修复与最终验证见 [实施记录](token-cost-alignment-implementation-2026-09-16.md)。

## 结论

**核心 Token 计数已在主要路径上对齐，字段并非直接同名同义；支持来源、所有边界和费用算法没有全面对齐。** Maclawd 当前金额是“按当前可找到的单价计算的 API 等价费用估算”，不能当成订阅实际账单，也不能承诺与 Vibe 网页金额一致。最新 Vibe 公共代码没有完整服务端计价引擎，无法对其最终美元数做全链路审计。

上一轮应用版本区分主要增加归属维度，不等于完成计费升级。本次发现价格正确性、服务档位及长上下文规则的具体缺口；价格自动刷新已经存在，但不能修复这些结构问题。

## 本次核对版本与依据

- Vibe CLI main：[`fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`](https://github.com/vibe-cafe/vibe-usage/commit/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5)，代码版本 0.10.31；最新稳定 GitHub release v0.10.21。比较以最新 main 为准，不能把尚未合并 PR 当成已实现。
- Vibe macOS app main：[`6feb8bcec3d034046d34f3709bd97f23190962c6`](https://github.com/vibe-cafe/vibe-usage-app/commit/6feb8bcec3d034046d34f3709bd97f23190962c6)，稳定版 v0.5.10。
- OpenAI Codex main：[`50d77959bf927293c4b5ddcca81d05331ae582ea`](https://github.com/openai/codex/commit/50d77959bf927293c4b5ddcca81d05331ae582ea)，stable `rust-v0.154.0`。核对 `codex-rs/protocol/src/protocol.rs` 的 TokenUsage、cache_write_input_tokens、service_tier。
- ccusage main：[`5e88263ed3c16cf79b42a71d93139cf17a50921c`](https://github.com/ccusage/ccusage/commit/5e88263ed3c16cf79b42a71d93139cf17a50921c)，stable v20.0.20。核对 `rust/crates/ccusage-core/src/pricing.rs`：明确缓存价来源、长上下文阈值、Fast multiplier 均有独立字段，说明不能用一个模型的五个固定单价完整描述所有请求。近期 #1737 涉及 JSON 未计价模型，#1739 涉及 Reserve 模型归属；未合并事项只作研究线索。
- 当日实际 GET [OpenRouter 公开目录](https://openrouter.ai/api/v1/models)，与 [OpenAI 官方价格](https://developers.openai.com/api/docs/pricing)、[Sol 官方模型页](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[Anthropic 官方价格](https://platform.claude.com/docs/en/about-claude/pricing) 交叉核对。
- 上游近期修复、issue、源码行及扫描/成本链路详见 [上游研究](vibe-usage-upstream-comparison-2026-09-16.md)。本轮不研究服务端额度，不使用凭据，不向网络发送本地日志或模型清单。

## 1. Token 口径：要先换算，才能比较

| 内容 | Maclawd | Vibe CLI 最新 main |
| --- | --- | --- |
| 普通 input | 不含缓存读、缓存写 | Claude/MiniMax 等将缓存写并入 input |
| output | 已包含 reasoning | Codex/MiniMax 的可见 output 与 reasoning 分开 |
| 缓存读 | cacheRead 单列 | cachedInputTokens 单列 |
| 缓存写 | write5m / write1h | 合并进 input，无独立 TTL 维度 |
| 完整总量 | input + write5m + write1h + output + cacheRead | totalTokens + cachedInputTokens |
| CLI totalTokens | 不直接使用这个上游名称 | input + output + reasoning，不含缓存读 |

本地证据：`src/runtime/usage-record.js:85-103`。上游证据：[aggregate.js](https://github.com/vibe-cafe/vibe-usage/blob/fcf1c3981890cf31267b1ee1adf88d61a75fdbb5/src/parsers/aggregate.js)。Vibe app 的 computedTotal 会再把缓存读加回；不能直接拿 Vibe CLI 的 totalTokens 与 Maclawd 完整总量比较并宣布重复计算。

`billable` 是保留兼容的内部名称，实际意义是“非缓存读取 Token”；缓存读仍会产生费用。reasoning 是 Maclawd output 的子集，不能再额外相加。

## 2. 本轮独立差分验证

使用最新上游真实解析器和 Maclawd 扫描器，同一时间固定数据、隔离缓存运行，不调用同步上传入口。

| 样本 | Maclawd 完整总量 | Vibe 完整总量 | 同时发现 |
| --- | ---: | ---: | --- |
| Claude：同调用部分响应、完整响应、不同 UUID 副本，含 5m/1h 写缓存 | 380 | 380 | 两者都按调用去重；本地保留两档 TTL，上游合并进 input |
| Codex：Fast、缓存读20、缓存写10、输出50含推理15 | 150 | 150 | Vibe 模型为 gpt-6-astra-fast；本地只剩 gpt-6-astra |
| MiniMax：仅包含数值白名单的冻结样本 | 一致 | 一致 | 模型未知时无法可靠估价 |

Claude 样本本地字段：input100 / output50 / cacheRead200 / write5m10 / write1h20；Vibe input130 / output50 / cachedInput200。Codex 样本本地 input70 / output50 / cacheRead20 / write5m10 / reasoning15；Vibe input80 / output35 / cachedInput20 / reasoning15。总量一致与字段相同不是一回事。

另外执行现有 usage-record、pricing、pricing-refresh、codex-reconciliation、rollup、usage-attribution、mcode-parser、scan 共80项测试，全部通过；独立运行上游aggregate/Claude/Codex/MiniMax/Cursor的83项测试也全部通过。测试通过只表明当前合同被满足；价格测试本身允许通用倍率，不能据此证明其符合最新供应商规则。

复现实验：`/tmp/maclawd-token-cost-compare.mjs`；输出：`/tmp/maclawd-token-cost-comparison-results.json`；测试日志：`/tmp/maclawd-token-cost-audit-tests.log`。这些临时文件不是发布依赖，也不包含会话正文或凭据。

既有审计覆盖过多维历史对账；本次分析阶段重新核对上游版本和固定样本，未把以前全量结果冒称本轮重跑。实施后的重新索引结果单独记录。

## 3. 已对齐与保留差异

- Claude：调用身份去重、保留最完整用量、缓存创建总量与TTL拆分取最大值防双计，主要行为一致。Maclawd另外保留TTL费用信息。
- Codex：累计差值、重复发射、计数重置、父子重放、逻辑会话与物理分段、现代cache write字段均已处理。原生来源拆分只在去重之后展示。**服务档位没有保留**，详见下一节。
- 扫描：本地有持久缓存、追加尾读、截断/重写检测、预算轮转、失败保留成功值、来源完整度。Vibe Codex也有索引/结果/尾读缓存与定期审计；实现结构与调度不同，不能宣称逐项相同。
- MiniMax：本轮真实数值完全对齐。显示已支持Token不意味着每条日志有可用于计价的模型ID。
- Kiro：上游包含估算Token/credits路径，本地只统计明确计数字段。不能把字符估算和真实Token混在一起，只为让总数相同。
- Antigravity：本地根据已核验的字段关系 output=visible+reasoning，不再额外加reasoning。上游仍将output和thinking分别加入聚合；本地也未启用其全部RPC路径。这里应保留有实证的差异。
- Trae CLI：本地把数值startTime作为毫秒或秒，上游按微秒除1000；嵌套span选取与reasoning处理也不同。本机没有样本，这仍是明确未对齐项，不能沿用“全部已完成”。
- Cline/Roo摘要降级、Hermes累计日志和缺真实样本的其他解析器仍不能保证所有跨日/套餐/存储变体一致。支持源集合也不同：上游另有Qoder/Qoder CN、DSH、Cola，以及合并进Codex/Pi的Cindy ledger，本地尚未接入；Cindy的Claude部分不能额外叠加原生日志。详见上游研究。
- 历史统计与实时短窗口不是同一条完整核对链路：Codex实时路径仍使用窗口指纹，跨父子身份与复杂分段的所有实时分支没有与历史reconcile同等级的对账证据。上面的“主要路径对齐”不扩展为全部实时行为。

## 4. 当前费用链路

本地：日志 → 规范化、去重 → 按来源/模型/项目/日及半小时累加Token → 查询时匹配最新价表 → 五档乘价求和。

```text
USD = (普通输入 × 输入价 + 输出(含推理) × 输出价
       + 缓存读 × 读取价 + 5m缓存写 × 5m价 + 1h缓存写 × 1h价) / 1,000,000
```

这个公式在“价正确、档位相同、请求无额外计费项目”的范围内成立。当前模型聚合不包含service tier、逐次请求输入长度、region、定价生效日期；这些信息丢失后不能从每日Token总量倒推回来。

价格优先级实际为：用户override > 8个写死的Claude官方价 > OpenRouter下载表 > opus/sonnet/haiku关键词兜底。成本不落历史快照，每次按当前表重算全部历史。因此价格变化会改变过去日期的估算，不能当作当时实际账单。

Vibe：CLI上传聚合计数，app读取API里的estimatedCost。公开仓库无法复原其完整服务器价格查找、阶梯和版本规则。其缓存TTL/Fast改造PR [#101](https://github.com/vibe-cafe/vibe-usage/pull/101) 仍未合并。不能声称本地照着其最终公式完整实现，也不能为了同一个美元数而丢掉本地已有的TTL维度。

## 5. 明确的费用问题与影响

### P1：硬编码旧价压过自动更新

`pricing.js:73` 把 Haiku4.5 定为输入$0.8、输出$4 /百万；最新官方和本次OpenRouter响应均为$1/$5。全档位均低20%。`priceFor()`先查OFFICIAL_PRICES，因此手动或自动更新目录都不会修正它。本次历史聚合未发现Haiku4.5，没有把这个潜在缺陷算成已经发生的本机损失。

### P1：聚合目录与一方价格冲突，当前未检测

本次实时OpenRouter GPT-5.6 Sol：输入$2、输出$10、缓存读$0.2；OpenAI当日官方价格及模型页：$4/$20/$0.4。Maclawd采用目录$2/$10。**如果产品承诺按当前一方标准API价估算，此项是官方标准价的一半。** 两来源冲突的原因未公开证实，不能猜测是折扣或更新延迟；更不能把目录视为官方直连账单。

相同 Token 样例采用这两组标准单价时，结果可相差一倍；这是价格来源差异，不代表实际付款。

### P1：长上下文阶梯已在下载响应中，但被丢弃

当日OpenRouter Astra对象带`pricing.overrides`，含`min_prompt_tokens:272000`以及阶梯价。`normalizeOpenRouter()`只返回五个基础单价，忽略overrides；模型聚合也没有保存逐请求阈值信息。

可复现样例：Astra单次30万非缓存输入、1万输出、标准处理。当前$3.50；按当前官方长上下文价$20输入/$75输出得到$6.75，低估约48.15%。此问题无需等待网络刷新，必须补齐数据合同和计价规则。

### P1：Codex档位丢失

官方协议存在service_tier；Vibe从2026-08-31起保留fast/priority/flex/batch模型后缀。本地`codex-accounting.js:36-49`从context只保存model，没有tier；缓存、rollup和costOf也没有对应字段。本轮同数据已复现。Fast可能低估，Flex/Batch可能高估，不能笼统认为所有费用只会偏低。

### P2：推导单价被当成完整已计价

- 缺缓存价时对所有供应商套0.1/1.25/2倍。最新Claude Fable5.1缓存读本身已是0.025倍；本机当前Fable5.1因目录有显式$0.25而正确，不是此模型已被算错，但通用倍率不能作为可靠降级规则。
- 含opus/sonnet/haiku任一关键词就有兜底价。本轮`made-up-opus-99`也返回$15/$75，说明“未知模型不猜价格”的注释与实现不完全一致。
- 明确免费input=output=0被丢弃为无价；应区分“已确认免费”和“未知价格”。
- 价格匹配没有返回按字段的来源/验证日期/置信度，覆盖率会把关键词兜底或推导字段当成已计价。
- provider前缀、preview/build等后缀归一化缺乏供应商级模型映射；用户配置别名不能一律当成公开模型型号。

### P2：未计价模型与缺计费项目

MiniMax 缺失 model、Kimi 订阅路由模型、Qwen preview 和 custom-local 别名均可能无法计价。应核对真实路由模型后映射，不能用当前选择模型回填所有历史。

工具调用固定费、云服务加价、地区/Batch/Fast、订阅包含额度和折扣均不能从现有五档Token费用直接推导。服务端订阅额度接口继续独立，不能由估算费用转换成“已付”或“剩余额度”。

## 6. 价格匹配率的解释边界

公开研究记录不包含开发机的用量、费用、会话规模或采集时间快照。价格匹配率表示可用费率覆盖的 Token 比例，不是金额准确率，也不是采集完整度。

价格表很新仍可能有来源冲突、字段丢失、模型别名和硬编码覆盖。既有自动任务具备启动检查、24小时过期刷新、新未计价模型触发和全局1小时限频；未知模型不一定能靠反复下载恢复。

## 7. 建议实施顺序与验收

1. 修正已证实的官方单价和来源冲突策略；官方快照须有核验日期/版本；禁止写死旧价永久压过已验证更新。显式免费保留为0，无证据价保持未知。
2. 贯通serviceTier与逐请求输入长度：解析 → 去重 → 缓存 → 计价维度 → 聚合。按供应商阈值和官方处理档位选择价格，不能只改模型字符串或对日累计量套阈值。迁移旧缓存并重新解析能恢复的日志。
3. 按供应商定义缓存规则，保留现有5m/1h；增加价格来源、缺失字段、降级状态。价格匹配覆盖与可靠价格覆盖分开。
4. 核验Kimi/Qwen等别名及MiniMax真实模型可恢复性；明确无法恢复的历史。补Trae时区/单位和缺失来源时另做官方交叉验证。
5. 建立固定样本差分测试：总量守恒、缓存拆分、fork/replay、分段、冷暖扫描、档位切换、阈值两侧、价表更新、免费/未知、缺模型和失败降级。Vibe作为解析行为参考；价格以官方合同和已核验响应为准。

费用目标应明确为“可解释、可追溯的API等价估算”。若要展示实际付款，则需供应商账单/消费明细，并独立说明订阅包含量与计费周期；本轮没有这一数据源。
