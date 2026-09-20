# Vibe Usage 更新对齐：实现与验收（2026-09-20）

本轮承接 [更新审计](vibe-usage-update-audit-2026-09-20.md)，实现其中确认适用于 Maclawd 的缺口。起点为 `09b5c80184065f2c72ffa5d71c72c6ef7a1b1711`。已有工作树改动单独保留，不属于本次提交。

## 实际核对的上游

- vibe-cafe/vibe-usage：默认分支及 npm 0.12.0 的 `b4a38745785a243ea23f5130285d78624f89a9f5`；GitHub stable v0.10.21 较旧，采用已经发布 npm 的实现作参考。
- vibe-cafe/vibe-usage-app：main `bc38182571728d48b394b0883ecca846f6ba860c`；stable v0.6.2 `5bbe63353395427f56d4260dcc439afddcdd0d1d`。main 的 appcast 修复不适用于当前无 Sparkle 链路的 Maclawd。
- Grok 官方：`4247f661689354b831191f11eeeac8424993fe3d`。采用官方 endedAt、modelUsage、包含缓存的 inputTokens，以及 fork 继承语义；不照搬 Vibe 中额外加 cacheWrite 的算法。
- MoonshotAI/kimi-code：`99eaa993bad28e2074fcf29f8b76c0ccf0f02b65`；MoonshotAI/kimi-cli：`86f136422a0aae6b217ea49e7ea1d2e8a1defcd2`。分别核对现代目录锁和旧版 Unix flock、地区域名、刷新阈值与轮换写回。
- openai/codex：`5c5308fc9a9ee789049d646ef11e5400384b9c6f`；robinebers/openusage：`519431b1345d9d6e2bffc7c12362eb4431a72e9b`。额度语义交叉验证见审计。
- Tokenleak：`fd38fa290d7cd4e317b95401f42a4aa2f3779808`，交叉验证 Droid 非缓存输入；Factory 官方 BYOK 与组织配置文档确认 custom id 与 API model 的区别。

最新 release、修复和 issue 检查以及不可直接移植的行为详见审计记录。实现依照 Maclawd 数据契约独立编写。

## 分部分提交

| 提交 | 完成内容 |
|---|---|
| c170ee6 | Droid 非缓存 input 不再重复扣减缓存；显式 customModels 映射；侧文件/目录配置进入缓存签名 |
| d6fdded | Grok 1.0 usage.json 与旧日志兼容、真实轮次时间、逐模型数据、fork 继承去重、不完整快照保留缓存 |
| d248364 | Cursor CSV 格式校验；未知表头或 HTML 不再覆盖已有统计；合法空表保留空数据语义 |
| 252a3c0 | Kimi Desktop 与现代/旧版 CLI 日志根、物理路径去重、各自项目索引与来源区分 |
| 0029462 | CodeBuddy、CodeArts Agent、Devin 本地解析及自动发现；SQLite 字段白名单、WAL 变化与多项目归属 |
| d5e76f9 | macOS Node 查找的 shell 回退改用限时、限输出文件，消除 wait-before-drain Pipe 死锁 |
| 0f2bb94 | Kimi 提前刷新、401 后刷新、KIMI_SHARE_DIR；兼容官方目录锁与 flock，原子写回并保护失败、登出和并行登录 |
| c53df30 | Claude message.speed 兼容，同时保留 usage 字段优先级 |
| f500409 | 复查修复：Droid 无配置映射时保留完整 custom ID，避免显示名碰撞导致错误定价 |
| aa5e634 | 复查修复：Grok 半截/损坏更新行不阻断完整账本 |
| 3dcc3e7 | 复查修复：parser context 变化时全量重解析，修复 Kimi 索引更新与日志追加同时发生时的旧项目归属 |

新增工具接入统一 parser/catalog 发现链路，因此有本地数据时进入统计来源；没有可靠订阅额度接口的工具不会被伪造成额度卡片。缓存版本更新为 27，以重建旧口径数据并保存增量解析上下文。

## 验收与边界

- 工作树全量测试 776/776 通过，原生 `swift build -c release` 通过。
- 最终代码 `3dcc3e7` 使用 `git archive HEAD` 导出到独立目录；该干净副本全量测试 776/776 通过，原生 Release 构建也通过，不依赖工作区已有未提交修改。
- 针对性覆盖包括冷/热扫描、追加/侧文件变化、fork 去重、格式异常保留缓存、项目索引联合更新、SQL WAL、新来源自动发现、子进程大输出/超时、凭据刷新失败与并发。旧版锁另用 Python fcntl 验证与 Swift helper 互斥。
- Standards / Spec 两轴复查共发现三个问题，均已修复并通过回归复查，无剩余阻塞项。
- 没有触发真实账户 OAuth 轮换、没有上传本地会话或凭据；新工具适配使用合成夹具验证，尚不等同于所有产品版本的真机验收。

不适用或仅供未来参考的项目不强行移植：Vibe 云同步、Sparkle/appcast、官方品牌图标、自绘 tooltip、取消选择即停止采集的产品语义、联网 @latest 启动。独立脱敏诊断导出属于可选增强，此次未新增导出界面。未知 Kimi 模型价格继续保持未知，不用其他模型价格填补。完整审计保留为实施前记录，本文件为实施后的状态。
