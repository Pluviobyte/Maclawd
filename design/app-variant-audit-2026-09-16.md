# 其他应用版本区分检查

> 此文记录实施前状态；后续完成情况见 [应用区分实现记录](app-variant-implementation-2026-09-16.md)。

检查时间：2026-09-16。只读检查当前工作区、已安装应用 Info.plist、数据目录名称、解析器与额度身份选择；未读取账户 Token，未请求账户接口，未修改运行逻辑。

## 结论

并非所有应用都像 WorkBuddy 一样按版本独立展示。需区分：同产品多入口合并、独立产品已隔离、尚未接入，三者不能互相等同。

| 对象 | 当前实际行为 | 缺口 |
| --- | --- | --- |
| WorkBuddy / WorkBuddy AI | 独立来源、配置与认证文件 | 已完成本次拆分 |
| Kimi 桌面 / Kimi Code CLI | 额度来源分别为 kimi / kimi-code，登录读取路径独立；本地 Token 解析为 CLI | 地区绑定会校验，但没有国内／海外两张独立卡片 |
| Claude Code CLI / Desktop Code / Cowork | 标准根、profile 根、Cowork 私有根均进入 claude-code | 没有按入口、profile 分栏；普通桌面聊天不能因此宣称已统计 |
| Codex 桌面 / CLI | 共用 Codex 来源与当前 CODEX_HOME | 不按桌面／CLI或多账户分栏；codex:limitId 是限额桶而非账户身份 |
| Antigravity 桌面 / CLI | 两个 conversations 根归入 antigravity | 未按入口分栏 |
| Cline / Roo Code | 两个不同 source、扩展 ID | 每个扩展跨 VS Code / Cursor / Trae / Trae CN 等宿主合并，宿主不是独立来源 |
| pi / oh-my-pi | pi / omp 独立解析器；pi 根排除 OMP 目录特征 | OMP 自身 profiles 仍合并 |
| 豆包 / 豆包工作 | 本地尚未提交代码仅接入 DoubaoWork 独立额度及登录目录 | 普通豆包未接入，不能称两版都支持；此实现尚不在 GitHub main |
| Cursor / Grok Bot | Cursor 固定读取 Cursor 目录；Grok Build 固定读取 .grok | 本机 Grok Bot 没有专用来源，不能等同于已支持的 Grok Build，也不能默认算入 Cursor |
| TRAE SOLO CN / Trae CLI | 本机安装 cn.trae.solo.app；解析器仅支持 trae-cli 缓存遥测 | SOLO CN 未接入，Trae / Trae CN 宿主目录扫描仅用于扩展统计 |
| MiniMax Code / MiMoCode | 本机安装 com.minimax.agent；MiMoCode 解析器读取 mimocode.db | MiniMax Code 未接入，二者不能因名称近似而等同 |
| Kiro | 解析器只读取 kiro-cli/data.sqlite3 | UI 名称 Kiro 没有标明 CLI；不能视为已支持 Kiro IDE |

本机同时存在 Doubao.app（com.bot.pc.doubao）和 DoubaoWork.app（com.work.pc.doubao）；还存在 Cursor.app、Grok Bot.app（com.anysphere.sand）、TRAE SOLO CN.app、MiniMax Code.app。应用存在与解析器支持范围分别核实。

安装状态多数仍由 dataDirs 存在推断，并非统一使用 Launch Services。残留目录可能误报，未生成数据目录也可能漏报；WorkBuddy 原生额度展示的 bundle identifier 探针不是全应用通用能力。

## 最新上游核对

联网核对以下默认分支、稳定 release 与近期 open issues；不把旧文档作为当前行为依据：

- robinebers/openusage main 56378e5765f85d38ff413036fd984afe3d4664e4，v0.7.11。近期 issue 涉及多 Codex homes、Claude profiles 凭据归属、Cursor Grok / Grok Bot 花费拆分。说明多账户和分支应用不可仅按品牌名归并；issue 只是线索，不是已实现能力的证明。
- vibe-cafe/vibe-usage main fcf1c3981890cf31267b1ee1adf88d61a75fdbb5，v0.10.21。实际读取最新 claude-roots、Trae CLI、Antigravity 解析代码：Claude roots 明确发现 Cowork 私有目录，Trae 输出 trae-cli 来源，Antigravity 采用共享 SOURCE。
- vibe-cafe/vibe-usage-app main 6feb8bcec3d034046d34f3709bd97f23190962c6，v0.5.10。核对版本与近期 issues，本次不据此声称 UI 支持具体版本。
- steipete/CodexBar main 034e01379a6e51312e22953ccf15ee54e8189473，v0.60.3。核对近期账户切换与 Cursor 套餐相关 issues，本次未修改其相关协议。

本次是现有支持范围审计，不新增未公开接口，不推算 Token 和服务端订阅额度之间的关系。将来若拆分同账户的桌面／CLI，只拆用量来源，不应复制同一份订阅额度造成双计。
