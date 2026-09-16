# 应用识别、入口归属与 MiniMax Code 接入

## 最新代码与取舍

2026-09-16 联网重新核对默认分支、稳定 release、近期提交和 open issues：

| 参考 | 实际 revision | 稳定 release |
| --- | --- | --- |
| vibe-cafe/vibe-usage | fcf1c3981890cf31267b1ee1adf88d61a75fdbb5 | v0.10.21 |
| vibe-cafe/vibe-usage-app | 6feb8bcec3d034046d34f3709bd97f23190962c6 | v0.5.10 |
| robinebers/openusage | 56378e5765f85d38ff413036fd984afe3d4664e4 | v0.7.11 |
| openai/codex | 50d77959bf927293c4b5ddcca81d05331ae582ea | rust-v0.154.0 |
| MoonshotAI/kimi-code | 402ee71c1a38addf424d3977064c7103728417db | @moonshot-ai/kimi-code@0.43.1 |

Vibe Usage 默认分支已到 0.10.31，实际读取 mcode、cursor、claude-code、antigravity、kiro、tools、codex-roots 等模块。选择默认分支的现代 MiniMax 账本发现方案，不能把这些能力宣称为 v0.10.21 的已发布能力。近期 issues 涉及 Cline 独立桌面共享数据目录、Dropped-source sessions、Claude 缓存写计价等，提醒必须保留去重与来源边界。OpenUsage 最新 issues 仍有多 home、多账户与新工具的支持缺口，故不把“同品牌”当作同账户证明。

Vibe Usage / app 未取得明确的可复用许可证声明。本次只参考路径、字段和行为，独立实现 Maclawd 的解析、缓存与 UI；不复制其实现、品牌资源或 UI。

供应商交叉验证：

- MiniMax Code 3.0.68 安装包中 @mavis/local-runtime 的 persistence/db、sqlite-persistence、layout/v2-paths 核实表结构和路径。供应商总量公式明确 input + output + reasoning，reasoning 与可见 output 分开。官方 pi-ai 适配器把缓存读写从普通 input 扣除。Maclawd 保持 input 不含缓存、output 包含 reasoning。
- Codex 最新 protocol.rs 核实 SessionSource 与 SessionMeta.originator。本机只统计这两个元数据字段，发现 Codex Desktop 常使用 vscode 通道，不能把 source=vscode 一概认为独立编辑器客户端；优先识别精确 originator=Codex Desktop。
- Kimi 官方 packages/oauth 的 region、managed-kimi-code、managed-usage 明确 .com/mainland-cn 与 .ai/global。这里只补显示标签，不增加登录读取入口或计费接口。
- 安装身份以各本机 Info.plist 与 Launch Services 对应的 bundle identifier 核实，不依赖应用显示名或固定安装路径。

## 已实现

1. MiniMax Code：读取 .minimax/v2/sqlite/runtime-state.sqlite；支持 MCODE_HOME 与诊断覆盖路径。仅查询 Token、模型、时间与项目字段，不读取 raw、record_json、extra_data_json。单一 SQL 快照连接会话项目，保留逐行项目；缓存签名包括 WAL，schema 变化保留上次成功结果并报告不完整。
2. 归属是 usageSource 元数据，canonical source 不变。Claude、Codex、Antigravity、Cline / Roo 都先做既有去重／复制历史核对，再由 rollup 选择展示来源，避免为了拆版本而重新命名去重空间。缓存保存归属和每行项目，缓存／聚合版本分别提升到 20 / 13。
3. Claude：区分 Cowork 私有目录与 Code 共享目录。Code 的 CLI／桌面共享根不能再可靠区分，显示为未区分，而非猜测。
4. Codex：精确区分 Desktop、CLI、Exec、编辑器通道、已知外部集成；子 Agent 缺少自身入口时从已知父会话继承；未知保持 Codex，不按文件名猜测。
5. Antigravity：按供应商桌面／CLI 目录区分。Cline / Roo：按已知编辑器宿主区分，含 Trae 国内／海外宿主；Cline .cline 目录标为独立版（CLI／桌面），不误称只有 CLI。
6. Kimi：桌面会员与 Code CLI 额度仍是独立 source，名称显示本次登录的国内／海外服务。没有创建两张重复订阅卡片；不是同时支持多个独立账户。
7. 应用目录：使用只读 AppKit Launch Services 查询已知 bundle IDs，一次批量查询、缓存一分钟。支持应用移动位置；区分“已安装”“检测到数据”“未检测到”。发现应用不等于支持统计，能力字段 usage=false 可传到原生 UI。
8. 设置页明确每个工具的覆盖范围；Kiro 改为 Kiro CLI。普通豆包、豆包工作、Grok Bot、TRAE SOLO CN、Kimi 桌面分别识别，不冒用相邻产品能力。豆包工作额度来自本地此前已存在的待提交实现，本次不宣称新增其接口。
9. 统计短标签保留 CLI／桌面差别；子来源采集进度读取所属解析器进度，不把同一批文件重复算入总进度。

## 验证

- 真机隔离临时缓存扫描：Claude 4,244 条、Antigravity 242 条，改前改后总 Token 完全一致；MiniMax 新接入 37 条，总 Token 1,782,703。
- Codex 全量扫描期间本任务仍在写日志，改后新增 4 条，不能以两个时刻的总量直接验证守恒。另复制冻结 4 个 CLI / 4 个 Desktop 小样本到临时目录，两个实现均产出 19 条、460,453 Token，只有来源归属变化。
- 自动测试：同调用副本去重、冷读／缓存／追加归属、Codex accounting 重建、MiniMax WAL 追加、缓存项目维度、schema 降级、应用 bundle 匹配、未知身份／失败、未支持应用的能力标记、Kimi 两地区标签与域名、原生解码和短标签。
- 测试与真机检查不输出登录凭据、用户输入或原始消息。

## 仍不宣称支持的范围

- TRAE SOLO CN：本机 ModularData/ai-agent/database.db 实测返回“file is not a database”；Vibe Usage 的 Trae CLI 解析不覆盖该存储，不能照搬成 SOLO 用量解析。
- Grok Bot：独立 bundle 与数据目录已识别，但它不是 Cursor state.vscdb，也不是 Grok Build 的 .grok 会话格式。没有经过核实的用量接口，不读取或尝试套用其 secrets 文件。
- 普通豆包、Kiro IDE：未取得可验证的本地 Token 或独立额度合同，只识别已经核实的产品，不以文字长度估算来冒充真实用量。
- 未区分入口的旧日志、同根多账户、Claude Code CLI／桌面与 MiniMax CLI／桌面共享账本，均不强行推断。订阅额度保持账户级，不随客户端拆分而重复展示或累计。

最终验证：736 项全量测试通过，Swift release 构建、应用打包与 codesign 校验通过。重启后的运行时 buildId 与新包一致；实际 API 已返回 MiniMax、Codex 各入口、Claude Cowork、Antigravity 两入口的独立统计来源。应用目录接口确认 Grok Bot、普通豆包、豆包工作、TRAE SOLO CN、Kimi 桌面和 MiniMax 分别识别，未支持产品 usage=false。历史索引升级后由后台自动重建。

## GitHub 提交验证

本次提交一并包含此前本地的豆包工作额度适配及其账户、服务端、原生展示和测试依赖，确保应用目录声明的能力在 GitHub 版本可用。额度拖动排序和 Cursor 百分比调整保留为本地独立改动。将 Git 暂存树导出到独立目录后重新执行 npm test：736 项全部通过；swift build -c release 通过。此验证不依赖未暂存改动。
