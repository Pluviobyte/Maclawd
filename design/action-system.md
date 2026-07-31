# Maclawd 动作系统总表与规划

**这份文档是从代码里抽出来的，不是照契约抄的。** 触发源、优先级、模式全部反映
`state-engine.js` / `orchestrator.js` 的实际行为——契约与实现不一致的地方在文末列出。

参照对象：[clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)
的动作集（20 个基础 + 6 个 mini）。它是同赛道更成熟的实现，但两边的强项不同。

---

## 一、总表：39 个动作

优先级数字越小越优先。「插播」表示一次性动作，播完回到当前最高优先级的循环态。

### 主状态（12）

| id | 动作 | 时长 | 模式 | 优先级 | 触发源 |
| --- | --- | ---: | --- | ---: | --- |
| `needs_owner` | Stuck Jar | 4.8s | loop | **1** | `PermissionRequest` / `Notification[permission_prompt\|idle_prompt]` |
| `error` | Basket Rescue | 4.8s | loop | 2 | `StopFailure`（matcher 进 variant） |
| `compacting` | Suitcase Fold | 4.8s | loop | 3 | `PreCompact` |
| `delegating` | Parcel Stack | 5.0s | loop | 4 | `SubagentStart` / `SubagentStop`（并发数决定 variant） |
| `working` | Tile Stack | 3.4s | loop | 6 | `PostCompact`、未知工具、速率推断 |
| `thinking` | Puzzle Turn | 4.6s | loop | 7 | `UserPromptSubmit` |
| `idle` | Quiet Watch | 5.6s | loop | 8 | 加权调度器 / `shell.resumed` |
| `away` | Blanket Tug | 3.8s | — | 9 | 静默超过 away 阈值 |
| `sleeping` | Top-down Sleep | 6.4s | loop | 10 | away 之后再静默 sleepMs |
| `waking` | Morning Stretch | 2.6s | 插播 | — | **从 away/sleeping 被唤醒**（本轮补上） |
| `success` | Self High-five | 2.9s | 插播 | — | `Stop` |
| `workspace` | Workspace Folder | 4.2s | 插播 | — | `CwdChanged` |

### 工作修饰（5）—— 全部优先级 5

| id | 动作 | 时长 | 触发源 | 可靠性 |
| --- | --- | ---: | --- | --- |
| `working.reading` | Pocket Book | 5.0s | `Read` / `Grep` / `Glob` / `NotebookRead` | 可靠 |
| `working.writing` | Letter Note | 4.6s | `Write` / `Edit` / `NotebookEdit` | 可靠 |
| `working.syncing` | Spool Sync | 4.4s | `WebFetch` / `WebSearch` / Bash 网络命令 | 可靠 / 启发式 |
| `working.building` | Block Stack | 5.0s | Bash 构建命令 | 启发式 |
| `working.testing` | Toy Check | 4.8s | Bash 测试命令 | 启发式 |

> Bash 三分类在 **hook 写入器进程内**完成，命令原文永不越界。
> 匹配不到高置信度模式一律回落 `working`——契约不允许从不可靠信号编出任务。

### 生命周期（8）

| id | 动作 | 时长 | 模式 | 优先级 | 触发源 |
| --- | --- | ---: | --- | ---: | --- |
| `launching` | Hello Unfold | 2.8s | 插播 | — | `SessionStart`（刚醒来时让位给 waking） |
| `quitting` | Goodbye Tuck | 2.8s | 插播 | — | `SessionEnd` |
| `waiting` | Claw Tap Wait | 4.2s | loop | **4.6** | `TeammateIdle`（本轮补上优先级） |
| `paused` | Statue Pause | 6.0s | loop | 外壳 4.3 | `shell.paused` |
| `moving` | Sideways Scuttle | 1.8s | 插播 | — | `shell.move` |
| `owner_resolved` | Jar Click | 3.2s | 插播 | — | `PermissionResolved`（仅当有待批准项） |
| `recovering` | Basket Breakout | 3.4s | 插播 | — | `ErrorResolved` |
| `cancelled` | Tiny Shrug | 2.8s | 插播 | — | **无触发源**（见缺口 1） |

### idle 变体（3）

| id | 动作 | 时长 | 触发源 |
| --- | --- | ---: | --- |
| `idle.grooming` | Claw Groom | 5.2s | 加权调度器（不受体力影响） |
| `idle.leg_shuffle` | Leg Shuffle | 4.8s | 加权调度器（不受体力影响） |
| `idle.drowsy` | Drowsy Nod | 6.0s | 加权调度器（**体力越低权重越高**，最多 6×） |

### 互动与环境（11）—— 外壳事件，仲裁优先级统一 4.3

| id | 动作 | 时长 | 模式 | 触发源 |
| --- | --- | ---: | --- | --- |
| `interaction.click` | Poke Squish | 2.2s | 插播 | `shell.click` |
| `interaction.double_click` | Surprised Hop | 2.4s | 插播 | `shell.doubleClick`（同时开面板） |
| `interaction.drag` | Hanging Loop | 3.2s | held | `shell.dragStart` |
| `interaction.drop` | Drop Wobble | 2.6s | 插播 | `shell.drop` |
| `interaction.hover` | Cursor Gaze | 3.0s | held | `shell.hover` |
| `ambient.edge` | Curtain Peek | 4.6s | loop | `shell.screenEdge` |
| `ambient.low_battery` | Low Battery Droop | 6.2s | loop | 电量 < 20% 且未充电 |
| `ambient.power_connected` | → **Morning Stretch** | — | 插播 | 接上电源（`mapsTo: waking` 别名） |
| `ambient.offline` | Signal Listen | 5.2s | loop | `NWPathMonitor` 断网 |
| `ambient.reconnecting` | Ready Wiggle | 3.0s | 插播 | 网络恢复 |
| `ambient.notification` | Attention Turn | 2.6s | 插播 | 应用通知 |

---

## 二、本轮从总表里查出并修掉的三个问题

做这张表最大的价值不是表本身，是它逼出了三个只看代码或只看文档都发现不了的缺陷。

**1. `waiting` 从未能显示。** 它不在 `PRIORITY` 表里，仲裁时取默认值
`PRIORITY.idle`(8)，而 `resolve()` 会把 `>= idle` 的状态全部过滤掉。
于是 `TeammateIdle` 事件正常收到、状态正常设置，**Claw Tap Wait 一次都没上过屏**。
现在优先级 4.6：压过工作修饰（agent 在等外部信号时显示「正在读文件」是错的），
让位于要人决定。

**2. `waking` 没有任何触发源。** 契约里 `away → sleeping → waking` 共用同一条毛毯、
颜色与褶皱语言一致，是一条刻意设计的连续故事。但引擎从 sleeping 直接跳到工作态，
**三个动作里有一个永远看不到**。现在从 away/sleeping 被唤醒时插播 Morning Stretch，
且刚醒来时不再叠加 `launching`——两个开场动作会打架。

**3. `ambient.power_connected` 的别名没生效。** 契约里写着 `mapsTo: "waking"`，
但编排器忽略 `mapsTo` 字段，服务端又按「必须有 `name`」过滤动作条目，
而别名条目只有 `id + mapsTo`，被整条滤掉。两处都修了。

---

## 三、与 clawd-on-desk 的动作集对照

它的 20 个基础动作：`idle` `idle-reading` `thinking` `typing` `building` `carrying`
`conducting` `juggling` `sweeping` `debugger` `headphones-groove` `error` `happy`
`sleeping` `notification` `bubble` `react-annoyed` `react-double-jump`，
外加 6 个 mini。

| 维度 | Maclawd | clawd-on-desk | 判断 |
| --- | ---: | ---: | --- |
| 工作细分 | **5** | 2（typing/building） | 我们更细，且有 `tool_name` 支撑 |
| 生命周期 | **8** | 0 | 我们独有 |
| idle 变体 | **3** | 1（idle-reading） | 我们更多，且受体力驱动 |
| 互动与环境 | **11** | 2（两个 react） | 我们更多 |
| 子代理 | 1 动作 + 2 变体 | **2 个独立动作** | 见缺口 2 |
| **mini 模式** | **0** | **6** | **唯一实质缺口** |
| 权限视觉 | 复用 Stuck Jar | 专用 bubble | 各有道理，见缺口 3 |

**结论：我们在「agent 在干什么」这条轴上更细，它在「桌宠自己是什么形态」这条轴上更全。**

---

## 四、缺口与规划

### 缺口 1：`cancelled`（Tiny Shrug）无触发源

Claude Code 的 hook 集里没有直接的「用户取消了这一轮」事件。
`SessionEnd` 的 `prompt_input_exit` matcher 语义是退出会话，不是取消当前轮。

**规划**：暂不强行接。可选路径是 `StopFailure` 的某些 matcher（用户中断可能落在
`unknown`），但把不确定的信号映射成明确的「取消」违背契约里
「不可靠信号必须回落」的原则。**保留动作待用，等上游出现可靠事件。**

### 缺口 2：子代理只有一个动作两个变体

它拆成 `headphones-groove`（一个子代理）与 `juggling`（多个），两个**独立动作**。
我们是 `delegating` 一个动作带 `one-subagent` / `two-or-more-subagents` 两个变体，
但**变体目前没有独立的视觉表现**——`orchestrator.plan()` 只是把 variant 透传出去，
渲染层并没有按变体切换任何东西。

**规划**：两条路选一。
- **A（省事）**：变体只影响道具数量（Parcel Stack 里助手从 1 个变 2 个），
  在同一个 SVG 里用 CSS 类切换。工作量小，符合「一个动作一个故事」的契约。
- **B（更直观）**：拆成两个独立动作，多子代理时用明显更忙乱的构图。
  这是它的做法，识别度更高，但要新画一个动作。

**建议 A**——契约的第 2 条明确要求「一个动作最多一个场景族」，
拆成两个动作会让「委派」这件事在视觉上分裂。

### 缺口 3：权限没有专用视觉

它有专门的 `bubble` 动画配合可点击的气泡。我们复用 Stuck Jar（拧不开罐子推给主人），
语义其实更贴切——**但 Stuck Jar 是循环动作，没有「这里可以点」的暗示**。

**规划**：权限气泡的交互层已经实现（`/api/permission` + 面板上的允许/拒绝），
但桌宠本体上没有任何可点击的提示。契约禁止在角色身上加文字与 UI 面板，
所以气泡应该是**角色之外的独立图层**，由外壳绘制，不进动作契约。
这属于外壳工作项，不是新动作。

### 缺口 4：mini 模式（完整纳入）

拖到屏幕边缘后收起成一个小尺寸形态，悬停探头、迷你告警、抛物线跳跃转场。

这不是「再画几个动作」，而是**第二套尺寸档下的完整行为模型**。规划如下：

**尺寸档定义**

| 档位 | 尺寸 | 用途 | 现状 |
| --- | --- | --- | --- |
| 主形态 | 128px（QA 64/96px） | 桌面常驻 | 已完成 |
| **mini** | **48px** | 贴边收起 | 待设计 |
| 菜单栏标记 | 22px | 状态指示 | 程序化占位 |

**mini 动作集（6 个，与 clawd-on-desk 同构但用我们的动作语言）**

| id | 建议动作名 | 语义 | 对应主形态 |
| --- | --- | --- | --- |
| `mini.idle` | Edge Doze | 贴边安静待命 | idle |
| `mini.peek` | Edge Peek | 悬停时探出半个身子 | 复用 Curtain Peek 的构图语言 |
| `mini.alert` | Edge Tap | 要人决定 / 出错时的迷你告警 | needs_owner + error 合并 |
| `mini.happy` | Edge Bounce | 任务完成 | success |
| `mini.enter` | Tuck In | 主形态 → mini 的收起转场 | 新增 |
| `mini.exit` | Pop Out | mini → 主形态的展开转场 | 新增 |

**关键设计约束（沿用现有契约）**

1. **mini 是状态的投影，不是独立状态机。** 状态引擎照常产出 39 个动作之一，
   由编排器在 mini 模式下把它**收敛到 6 档**——和菜单栏标记收敛到 5 档是同一个机制。
   绝不为 mini 建第二套状态机，那必然漂移。
2. **收敛表要显式声明**，不能靠前缀猜。放进 `design/mini-actions.json`。
3. **48px 必须进 QA 尺寸档**（现在是 64/96px），和 22px 一起补。
4. **转场不可跳过。** `mini.enter` / `mini.exit` 是 oneshot，
   主形态与 mini 之间不允许瞬切——那会让桌宠看起来像闪烁的 bug。

**实施顺序**：22px 标记定稿 → 48px mini 静态形态 → 6 个 mini 动作 → 转场 →
编排器收敛表 → 外壳的贴边检测与切换。

**这一整块阻塞在设计上，不在工程上。** 收敛机制与外壳的贴边检测都是现成的
（`ambient.edge` 已经能触发），缺的是 48px 下可读的角色形态设计。

---

## 五、契约与实现的不一致（待对齐）

总表抽取过程中发现的，都不影响当前行为，但会让后来者困惑：

| 动作 | 契约写的 | 实现的 | 建议 |
| --- | --- | --- | --- |
| `away` | `mode: oneshot` | 持续态，有优先级 9 | 契约改成 loop |
| `moving` | `mode: loop` | 在 ONESHOT 集里 | 契约改成 oneshot |
| `interaction.hover` | `mode: held` | 在 ONESHOT 集里 | 实现改成 held（悬停持续期间保持） |
| `interaction.drag` | `mode: held` | 走外壳会话持续态 | 一致，契约里 `held` 应正式定义 |

`held` 这个模式在契约里出现了但从未被正式定义。建议补上：
**held = 条件成立期间持续显示，条件消失后回到仲裁结果**，
与 loop（自然循环直到被替换）和 oneshot（播完即回）并列为第三种模式。
