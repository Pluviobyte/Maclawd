# Maclawd 与 Clawd on Desk 功能对比及借鉴建议

> 调研日期：2026-08-05
>
> Maclawd：`5e7cee3dfbf60815aaa8c9ffecc974eb4569c17b`
>
> Clawd on Desk：`b6ec1fbd5ec7605c83ac15adb817d0d677d4da42` (`main`)
> 方法：以两个仓库的源码、测试、配置和一手文档为准；不把 roadmap 当成已实现功能。Maclawd 当前测试结果为 501/501 通过；Clawd on Desk 在安装 Electron 依赖后为 6805 项、6784 通过、0 失败、21 跳过。

## 结论摘要

Maclawd 并不是 Clawd on Desk 的简化版，而是产品重心不同：

- **Maclawd 强在「本地 AI 用量与容量决策」**：21 个工具的用量解析、Token/缓存/成本口径、项目/模型/工具分布、热力图、订阅额度和原生 macOS 面板。
- **Clawd on Desk 强在「多 Agent 实时控制面」**：20+ Agent 的 hook/plugin 集成、权限弹窗、会话 HUD/仪表盘、集成安装与 Doctor、远程 SSH、主题生态和跨平台发行。[README](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/README.md)
- 最值得借鉴的不是换成 Electron 或复制它的角色，而是补齐 **原生权限操作卡、实时会话 HUD、Agent 集成管理/诊断** 这三条产品回路。
- Maclawd 已有这三条所需的部分底层，不需要从零重做：权限 broker/API、多会话优先级仲裁、PID/CWD 聚焦目标、hook 健康检查都已经存在。

## 1. Maclawd 当前真实功能

### 1.1 原生 macOS 桌宠与交互

- Swift 6/AppKit 原生外壳，透明无边框窗口，用 `WKWebView` 直接渲染 SVG/CSS 动画，状态、采集和聚合留在本地 Node 运行时。[启动与边界](../mac/Sources/Maclawd/main.swift#L5-L13)
- 单击、双击、拖拽、落地、悬停、贴边 mini、多屏位置恢复、空白区域点击穿透以及丢失后居中恢复。[桌宠窗口](../mac/Sources/Maclawd/PetWindow.swift)
- 低电量、接通电源、断网/重连、鼠标存在信号会进入状态引擎；等待用户时单击可跳回发起请求的终端。[系统事件与终端聚焦](../mac/Sources/Maclawd/main.swift#L81-L97)
- 桌宠窗口具有动作级的命中框/可见边界，不是用整个透明方框拦截鼠标。

### 1.2 状态引擎与动画系统

- 38 个已定义动作及其扩展状态，包括思考、工作、测试、构建、重试、长时工作、委派、等待主人、成功/错误、睡眠链、桌面交互和自发行为。
- 每个会话独立保存状态，用优先级选出当前唯一画面；`needs_owner > error > compacting > delegating > working > thinking`，同级选最近事件。[优先级定义](../src/runtime/state-engine.js#L9-L39)
- 已支持子 Agent 数量分档，1 个与 2+ 个使用不同 variant，因此“子 Agent 感知”不是空白项。[子 Agent 映射](../src/runtime/state-engine.js#L562-L570)
- 包含最小驻留、一次性插播、Stop 防误庆祝、死会话过期、启动租约恢复、无 hook 时 Token 速率降级、能量模型和分阶段睡眠。
- 状态选择坚持“可观测才细分”：短工具不伪造细粒度动作，只有高置信 Bash 模式才分成 building/testing。[工作分类原则](../src/runtime/state-engine.js#L86-L120)

### 1.3 实时 Agent 事件

- 当前高保真实时事件主要来自 **Claude Code**：14 类 hooks、命令本地分类、脱敏白名单、异步超时和端口自动发现。[事件适配器](../hooks/maclawd-hook.js#L1-L22)
- 其他工具的“支持”主要是**用量日志解析**，不应误说为同等实时状态集成。没有 hook 时，状态引擎只能根据 Token 速率保守地推断 working/idle。[速率降级](../src/runtime/state-engine.js#L656-L672)

### 1.4 用量、统计与额度

- 21 个本地 AI 工具解析器：Claude Code、Codex、WorkBuddy、Kimi、Qwen、Grok、Gemini CLI、Copilot CLI、Pi、OpenClaw、Amp、Droid、Cline、Roo Code、Trae、opencode、ZCode、Hermes、Kiro、Antigravity、Cursor。其中 7 个有真实日志验证，其余为合成 fixture/移植口径，界面会区分“支持”与“已验证”。[解析器注册表](../src/runtime/parsers/index.js)
- 统一口径区分输入、输出、reasoning、缓存读写、总 Token、非缓存读取和估算成本，并保留价格覆盖率与未完成采集标记。
- 原生面板包含概览、额度、统计、设置；统计有时间范围、上期对比、趋势、7×24 热力图、工具/项目/模型分布和会话活跃时间。[原生统计页](../mac/Sources/Maclawd/AnalyticsView.swift)
- 订阅额度已分开 Codex 官方 CLI 读取与 Claude Code statusline 通道，能表达 live/quiet/reset、重置时间、阈值提醒和一周期一次去重。

### 1.5 已有但未完成产品化的能力

- **权限 broker 已存在**：支持 Claude Code HTTP `PermissionRequest`、脱敏摘要、25 秒超时不表态、Allow/Deny API，且默认关闭。[权限 broker](../src/runtime/permissions.js#L4-L24) [API](../src/runtime/server.js#L680-L710)
- 但当前只有 `web/pet.html` 里的权限列表，**没有跟桌宠紧邻的原生操作卡**，而设置默认页也没有露出该开关。
- **多会话仲裁数据已存在**，可返回每个会话的状态、优先级、PID/CWD 和当前胜者；但用户看到的原生面板只有历史会话统计，没有实时会话列表/HUD。
- **LAN 手机镜像已存在**：默认关闭、仅 GET 白名单、配对令牌、手动旋转/重置、旧令牌宽限、强制只读和移动页。安全思路与参考项目接近，但参考项目的 WebSocket、定时自动轮换、连接上限和速率限制更产品化。[LAN 边界](../src/runtime/lan.js#L5-L32)
- **hook 安装/健康/自愈已存在**，但没有整合为一个用户可读的“Agent 连接中心 + Doctor”。
- 已能将自带的 Maclawd v2 宠物包一键安装到 Codex，但不能反向导入其他 Codex Pet，也没有通用主题系统。[安装器入口](../mac/Sources/Maclawd/PanelSettings.swift#L167-L253)

### 1.6 成熟度和未完成项

- 501 个自动化测试全部通过，覆盖 Token 口径、状态可达性、脱敏、hook 安装、权限、LAN、额度、原生 UI 源码合同和运行时生命周期。
- 未完成 Developer ID 签名/公证，公开分发仍会碰到 Gatekeeper。
- DMG 可构建 universal 版，但要携带 arm64/x86_64 两套 Node，体积大；无完整自动更新链路。
- 14 个用量解析器未用真实日志验证；全天 dogfood 与最终 `working` 动画选型仍是明确空缺。
- README/PROGRESS 存在时间漂移：顶部仍说“没有可下载 App/运行时未开始”，但实际代码已经超过该阶段。

## 2. Clawd on Desk 当前功能和架构

### 2.1 实时 Agent 集成

- 支持 Windows 11、macOS 和 Linux，以 Electron 为应用外壳，目前仓库版本为 `0.14.0`。
- README 列出 20+ Agent，通过 command hooks、HTTP hooks、官方 hooks、JSONL fallback、plugin/extension 或本地日志轮询接入；各 Agent 的状态、权限、终端聚焦能力不同，项目有明确的能力边界说明。[Multi-Agent Support](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/README.md#multi-agent-support) [Known Limitations](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/docs/guides/known-limitations.md)
- 支持多会话并存、进程存活检测、启动恢复、子 Agent 数量动画分档和高优先级状态仲裁。[状态映射](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/docs/guides/state-mapping.md)
- 用户可从 Settings 为每个 Agent 安装/修复集成，还支持自定义 HTTP Agent 和 Remote SSH hook 部署。

### 2.2 权限与用户操作回路

- Claude Code、Codex、CodeBuddy、opencode、MiMo Code 等支持的 Agent 可在桌宠旁弹出权限卡，进行 Allow/Deny 及 Agent 支持的 Always/规则操作。
- 多个请求向上堆叠，弹窗存在时临时注册全局快捷键，如果用户已在终端回答则自动消失，并可按 Agent 单独关闭。[权限弹窗功能](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/README.md#permission-bubble)
- 项目也接入 Telegram/飞书审批、自动权限策略等更高风险能力，但这些不适合直接成为 Maclawd 的近期范围。
- 权限层不把所有交互都当成同一种 approval：工具批准、人类问题、计划审阅和普通通知分类处理，未知工具不会自动放行。[权限自动化策略](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/src/permission-automation-policy.js#L5-L46)

### 2.3 会话智能

- 会话 Dashboard 和靠近桌宠的 HUD 显示当前会话、近期事件、别名、Agent 图标和优先状态，并可跳到特定终端或打开项目。[会话智能](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/README.md#session-intelligence)
- Codex `request_user_input` 可显示为只读问题卡；由于官方 hook 并不暴露该事件，答案仍留在 Codex 原生 UI，这是一个值得借鉴的“提醒不等于代答”边界。[限制说明](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/docs/guides/known-limitations.md)

### 2.4 桌宠、主题与定制

- 三个内置主题，自定义主题支持 SVG/GIF/APNG/WebP/PNG/JPEG，有脚手架、验证器、分层创作路径、能力 badges、状态 fallback、命中框、mini、声音和个性化。[主题指南](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/docs/guides/guide-theme-creation.md)
- 可导入 Codex Pet zip，将 atlas 转成受管主题。外部 SVG 按不可信输入处理，移除 script、事件属性、外部 URL、绝对路径和路径穿越，保留安全的 CSS 动画与本地 fragment 引用。[主题安全边界](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/docs/guides/guide-theme-creation.md#external-theme-runtime-limits)
- 支持光标跟随、多段睡眠、单击/连击彩蛋、拖拽、边缘 mini、自由漫步、体积/置顶/配件/颜色调整和声效。

### 2.5 系统与运维

- 移动 PWA 为局域网 WebSocket 只读镜像，token 门控、24 小时自动轮换、5 分钟宽限、连接数与速率限制；不传 prompt、tool input、完整 cwd 和 transcript。远程审批仍与这条只读链路分开。[移动伴侣](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/README.md#mobile-companion-pwa) [移动数据边界](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/docs/mobile-protocol-v1.md#L3-L10)
- 有单实例、开机启动、DND、声效、尺寸、系统托盘、更新检查、多屏适配和 5 种 UI 语言。
- 有集中 Doctor，检查 Agent 集成、hook 活跃、权限策略、主题健康、本地服务等，并导出脱敏诊断报告。
- 结构已非小型示例：主进程、桌宠、权限 bubble、HUD、Dashboard、Settings、PWA、Remote SSH、主题、Updater 分成独立模块与窗口。
- Agent 适配器以注册表和声明式 capability/event map 组织，UI 不需要为每个 Agent 重新硬编码。[适配器注册表](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/agents/registry.js#L4-L49)
- 桌宠在 Electron 中用渲染窗口 + 按主题 hitbox 缩小的输入窗口解决透明区域拦截。Maclawd 已用原生 `NSWindow` 动态命中框解决同一问题，因此只需借鉴“渲染与输入几何分离”的原则，不应照搬双窗口。

## 3. 功能对比矩阵

| 维度 | Maclawd | Clawd on Desk | 判断 |
| --- | --- | --- | --- |
| 产品定位 | Mac 原生桌宠 + 本地 AI 用量/额度助手 | 跨平台桌宠 + 多 Agent 实时控制台 | 不应简单合并为一种定位 |
| macOS 体验 | AppKit/SwiftUI + WKWebView，系统集成深 | Electron | Maclawd 保持优势 |
| 实时 Agent 覆盖 | Claude Code 为主，其他多为用量扫描/速率降级 | 20+ Agent，多种 hook/plugin 方式 | 参考项目明显更强 |
| 用量统计 | 21 工具、细 Token 口径、成本/覆盖率/热力图 | 不是核心强项 | Maclawd 差异化核心 |
| 订阅额度 | Codex + Claude，严格 freshness/reset 语义和阈值提醒 | Orbit 环 + Dashboard 额度 | Maclawd 数据语义更深；可借鉴桌宠旁的 glanceable 表达 |
| 权限决策 | Claude 后端 broker/API 已有，原生 bubble 未完成 | 多 Agent、堆叠卡、快捷键、自动消失 | Maclawd 最明确的短板与快赢点 |
| 会话管理 | 底层仲裁/PID/CWD 有，只显示当前胜者 | HUD + Dashboard + 别名 + 跳转 | 值得补原生实时 UI |
| 子 Agent 感知 | 已有 1/2+ variant | 已有并有专属动画 | 能力已有，只需增强可见性 |
| 桌宠动作 | 38 动作、较强的状态真实性与能量模型 | 12 主状态 + 分层主题/反应 | Maclawd 不需追加动画数量 |
| 主题生态 | 固定 Maclawd；可安装到 Codex | 内置/第三方主题 + Codex Pet 导入 + sanitizer | 中期可借鉴，但有品牌与安全成本 |
| 手机 | token 门控只读 LAN 页，手动旋转 | 只读 LAN PWA，WebSocket、自动旋转和限流 | 核心安全边界已有；参考项目产品化更完整 |
| 诊断 | hook health/覆盖率/运行时状态分散存在 | 集中 Doctor + 脱敏报告 | 值得借鉴信息架构 |
| 远程工作流 | 无 Remote SSH/WSL hook 管理 | 已有 | 只在有真实需求后再做 |
| 发行 | Universal DMG 可构建，未签名/公证/自更新 | Windows/macOS/Linux 安装包与更新链路 | Maclawd 的 P0 应是签名发行，不是跨平台 |

## 4. 建议借鉴的功能

### P0：原生权限操作卡

**为什么第一：** 底层 broker、API、脱敏和 fail-open 语义都已完成，当前缺的是用户真正能看见和点击的原生回路。这是价值高、重复工作少的项目。

**建议范围：**

1. 桌宠旁独立 `NSPanel`/无焦点操作卡，显示 Agent、工具、脱敏路径/命令摘要和剩余时间。
2. Allow / Deny；第一版不做“Always”，因为它涉及永久规则写入和更复杂的语义。
3. 多请求堆叠，但最多露出 3 张，其余显示计数，避免占满屏幕。
4. 卡片存在时才注册快捷键，窗口消失后立即注销。
5. 如果请求已在终端解决，卡片自动消失；超时继续保持“不表态、交还 Agent”。
6. 开关仍默认关闭，首次开启要明说会安装拦截型 HTTP hook。

**预估：** 中等工程量，高产品价值。首版只支持 Claude Code，不要为了看起来“多 Agent”而伪造支持矩阵。

### P0：实时会话 HUD / 面板

**为什么：** Maclawd 现在会把多会话压缩成一个胜出动作，用户知道“有事”，却不知道“还有哪些事”。引擎已经有会话、PID、CWD、优先级和子 Agent 数量。

**建议范围：**

- 在原生面板首页加“现在”区，最多 3 个会话：Agent / 项目名 / 普通语言状态 / 持续时间。
- 胜出会话标记“桌宠正在显示”，而不显示“priority=1”这类内部术语。
- 可用 PID 时提供“跳回终端”；不可用时说清原因，不伪造按钮。
- 路径默认只显示项目尾名，完整路径放辅助信息，遵循已有隐藏项目设置。
- 暂不做浮动常驻 HUD；先验证面板内实时列表的使用频率，再决定是否增加第二个常驻窗口。

**预估：** 中等工程量，高价值。

### P0：Agent 连接中心 + Doctor

**为什么：** Maclawd 目前最容易误解的地方是“21 个工具支持”。它实际上混合了“能读用量”、“已用真实数据验证”、“有实时状态”、“可处理权限”四种不同能力。

**建议范围：**

- 一个按 Agent 的能力矩阵：`用量采集 / 真实样本已验证 / 实时状态 / 权限操作 / 终端跳转 / 额度`。
- 安装、卸载、修复、最近事件时间和失效原因收在同一处。
- 导出脱敏诊断报告，重用现有 `hook-health`、runtime identity、parser coverage、endpoint 与 redaction。
- 先把 Claude Code 做完，再用统一 adapter contract 扩展 Codex 官方 hook；不要把 21 个 parser 都升级成 hook 作为一个大项目。
- 为每个 Agent 建立声明式 descriptor，至少包含 `identity / eventMap / installStatus / health / capabilities / processNames`；连接中心和运行时都消费这一份真值，避免 UI 中散落 Agent 特判。

**预估：** 中等工程量，高信任价值。

### P0：签名、公证、更新闭环

这不是参考项目最显眼的功能，却是 Maclawd 从“开发机上可用”到“可交付产品”的硬门槛。在做更多娱乐化功能前，先完成 Developer ID、notarization、稳定版本号、更新检查和可回滚安装。

### P1：更好的 Agent 适配器合同

参考 Clawd on Desk 的“每个 Agent 显式声明能力”，为 Maclawd 定义统一适配器：

```text
identity + installStatus + health + eventStream
+ permissionMode + focusTarget + quotaProvider + usageParser
```

现在的 usage parser 和 Claude hook 不必立即重写，可先用 capability descriptor 包住它们。下一个高价值实时集成建议选 **Codex 官方 hooks + JSONL 降级**，因为 Maclawd 已有 Codex 额度、Codex Pet 和 Codex 用量，用户认知链最短。

### P1：轻量安静模式

借鉴 DND，但按 Maclawd “安静、不打扰”的性格改造：

- 保留采集，不弹额度/权限卡，权限立即交还 Agent 原生流程。
- 桌宠可隐藏或进入 mini，菜单栏仍可见。
- 支持 1 小时/到明天/手动恢复，不需要复制参考项目全部 DND 语义。

### P2：Codex Pet 导入与受限外观包

参考项目的主题系统很成熟，但完整复制会让 Maclawd 从“一个有自己性格的 Mac 伴侣”变成“桌宠引擎”。更合适的路线是：

1. 首先支持导入已有 Codex Pet v2，只映射 Maclawd 核心状态。
2. 缺失状态必须有明确 fallback，用 capability badge 告知 mini/点击/睡眠/光标跟随是否支持。
3. 所有导入 SVG 必须走 sanitizer；不运行外部 JavaScript，不读网络资源，不接受路径穿越。
4. 等用户确实需要后，再扩展成完整 theme schema；不先做配件商店/主题市场。

### P2：Remote SSH 状态桥

适用于用户经常在远程服务器上跑 Agent 的场景。建议先只做状态和完成提醒，不做远程权限批准；需要有主机身份、会话隔离、密钥存储和卸载/修复边界后再进入开发。

## 5. 不建议直接借鉴的功能

### 不转 Electron，不追跨平台

Maclawd 的名称、交互、菜单栏、终端聚焦、登录项、多屏与可访问性都以 macOS 为中心。转向 Electron 会牺牲已有优势，而不会自动带来 Clawd on Desk 的集成深度。

### 不优先做 Telegram/飞书远程批准

Maclawd 已把手机桥明确设计为只读。远程批准会改变威胁模型，引入凭证、重放、身份绑定、传输安全和误批风险，不应为了功能表对齐而做。

### 不让通知自动抢焦点

Maclawd 当前只在 `needs_owner/error/waiting` 且用户主动单击时跳回终端，这比“提醒一来就切窗口”更符合安静定位。可借鉴终端跳转的覆盖范围，不应借鉴抢焦点行为。

### 不继续以“动画数量”为主指标

Maclawd 已有更多动作，当前真正的产品缺口是实时集成、用户操作回路和可交付性，不是再加十个彩蛋。

### 不立即做完整主题市场

主题加载不只是“换几张图”，它还包含 schema 版本、资产安全、能力降级、布局/命中框、动作时长、第三方许可证和兼容性支持。先做受限 Codex Pet 导入就足以验证需求。

## 6. 建议路线图

### 阶段 A：把已有底层变成可用产品

1. 原生权限卡（Claude Code only）。
2. 面板“现在”会话列表与终端跳转。
3. Agent 连接中心，明确区分用量/实时/权限/额度能力。
4. 脱敏 Doctor 报告。
5. Developer ID 签名、公证和更新闭环。

### 阶段 B：扩展高价值 Agent 集成

1. Codex 官方 hook + JSONL fallback。
2. 将集成能力收敛到统一 adapter/capability contract。
3. 对真实用户排名前 3 的 Agent 做 hook，而不是一次补齐 21 个。
4. 轻量安静模式与可选额度 Orbit/菜单栏 glance 表达。

### 阶段 C：经过需求验证后扩展生态

1. 受限 Codex Pet 导入 + sanitizer + capability badges。
2. 如有明确用户需求，再做 Remote SSH 只读状态桥。
3. 最后才评估完整主题系统、常驻 HUD 和更多定制项。

## 7. 许可证边界

Clawd on Desk 使用 **GNU AGPL-3.0**。[许可证](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/LICENSE) Maclawd 当前是 all-rights-reserved 项目，因此：

- 可以借鉴产品思路、交互模式、功能分层和公开协议事实。
- 不要直接复制其源码、样式、动画资产或主题实现，除非决定按 AGPL 履行对应义务，或另行获得授权。
- 建议以本文的产品合同为输入，由 Maclawd 按自身 Swift/Node 架构独立实现。
- 参考仓库的角色美术资产还有单独的 All Rights Reserved/非商业限制，因此“不拷贝美术资产”比代码许可证问题更明确。[资产许可](https://github.com/rullerzhou-afk/clawd-on-desk/blob/b6ec1fbd5ec7605c83ac15adb817d0d677d4da42/assets/LICENSE#L1-L22)

## 最终建议

下一个完整版本的主题应该是：

> **让 Maclawd 从“会反应的本地统计桌宠”进化成“能看懂并安全接手当前 Agent 现场的 Mac 伴侣”。**

对应的三个核心交付是：**原生权限卡、实时会话面板、Agent 连接/Doctor 中心**。它们都能复用当前底层，同时能保住 Maclawd 的三个差异化：原生 macOS、本地隐私和用量/额度透明度。
