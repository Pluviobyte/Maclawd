# Maclawd Token 记录方案 v1

状态：**数据层已实现并在真机验证**（阶段 0–3 完成，见文末「实现现状」）。桌宠接入待
状态引擎就绪。这是 Maclawd 运行时的第一块，在任何 macOS 应用代码之前独立跑通。

## 定位

Token 记录不是给 Maclawd 加一个数字显示，而是给它**接上感官**。

PROGRESS.md 阶段一要求「定义公共事件适配器，映射可靠的 Codex/Claude/tool 事件」。
本方案就是那个适配器的第一个真实数据源：Claude Code 的本机日志与 hook 事件，
一路驱动 38 个动作，一路汇总成可查看的用量。

范围内：
- Claude Code 的 token 计数、成本估算、项目与模型拆分
- Claude Code hook 事件 → Maclawd 状态
- 纯本地存储与展示

范围外（v1 不做）：
- Codex / Cursor / 其他工具（只有 Claude Code 有 hook 通道，先把一条链做透）
- 任何云端、账号、上传
- 配额/额度百分比（需要读 Claude Desktop 的 Chromium 缓存，脆弱且与本方案正交）

## 不可变原则

1. **纯本地。** 不联网。唯一例外是用户显式点击「更新价格表」。
2. **不落盘内容。** 不写任何 prompt、回复、文件内容。只存聚合数字、模型名、项目目录名。
3. **不拖慢 Claude Code。** hook 写入器预算 15ms，绝不阻塞，Maclawd 未运行时立即静默退出。
4. **角色身上没有文字。** 主状态契约第 6 条禁止文字与 UI 面板，token 数字只能出现在
   菜单栏与面板。角色只承载「强度」这个模拟量。
5. **缓存可删。** 解析缓存随时删除都不影响正确性，下次重建。
6. **卸载即净。** 全部数据在 `~/Library/Application Support/Maclawd/`。

## 开关与默认值

**Token 统计默认开启，可在设置中关闭。** 但「开启」必须分层——A 层和 B 层的侵入性
不在一个量级，不能用同一个默认值。

| 层 | 默认 | 理由 |
| --- | --- | --- |
| **B 层（读本机日志）** | **开** | 纯只读，不写任何不属于 Maclawd 的文件，不联网。桌宠开箱即有感知。 |
| **A 层（Claude Code hooks）** | **关**，首次引导时询问 | 要写 `~/.claude/settings.json`，且每次 `PostToolUse` 都会拉起一个进程。这是在改用户另一个工具的运行时，不能默认替他决定。 |

即：**开箱即用的是「读日志」，hook 是可选增强。** 没有 hook 时状态从 token 速率
推断，桌宠完整可用，只是无法区分 thinking / delegating / compacting。

### 首次启动披露

默认开启不等于默默开启。首次启动显示一次**非阻塞**提示条：

> Maclawd 正在读取本机 Claude Code 日志来记录用量。纯本地，不联网，可在设置中关闭。
> 　　　　　　　　　　　　　　　　　　　　　　　　　　　[ 了解 ]　[ 打开设置 ]

不用模态弹窗——默认开启的功能配阻塞弹窗是自相矛盾的。但披露必须有，否则「读取
用户日志」就成了偷偷进行的行为。

### 关闭的语义

一个开关关掉三件事会造成歧义，所以拆开：

| 设置项 | 关闭后 |
| --- | --- |
| 记录 token 用量（主开关） | 停止扫描、停止 tail、释放文件句柄、取消定时器。**已有数据保留。** |
| 用用量影响桌宠行为 | energy 层失效，idle 变体权重回到静态默认。依赖主开关。 |
| Claude Code 事件增强 | 卸载 hook（从 `settings.json` 移除自己写入的条目，不动其他条目）。 |
| 删除全部用量记录 | 独立的破坏性操作，二次确认，不挂在主开关上。 |

关闭必须**立即且可验证**地停止后台活动。用户关了开关之后还有文件轮询，是信任问题
而不是性能问题。

### 重新开启

`rollup.json` 是纯派生数据，本机日志仍然完整，所以重新开启时**直接全量重建**，
自动补齐关闭期间的记录，不询问。

### 连带约束：不能启用 App Sandbox

`~/.claude` 不受 TCC 保护，非沙盒应用可以静默读取——这是「默认开启」能成立的前提。
但一旦启用 App Sandbox，读取 `~/.claude` 就必须让用户走一次文件选择授权，默认开启
立刻不成立。

**结论：Maclawd 走 Developer ID + DMG 分发（PROGRESS.md 阶段四已如此规划），
不启用沙盒，因此也不上 App Store。** 这是本决定的直接后果，需要在产品层面确认。

## 三层架构

```
A 事件通道（Claude Code hooks）        延迟 ~0     → 状态
      │ 极轻量写入器 → Unix socket
      ▼
B 计数通道（本机日志）
   ├ 实时 tailer（offset 跟读）        1s          → tokens/min → 强度
   └ 历史扫描（mtime:size 缓存）       30s         → 日/周/月聚合
      ▼
C 表现层
   ├ 角色动画（无文字）
   └ 菜单栏 / 面板（数字在这里）
```

**hook 告诉你「什么时候、在干什么」；日志告诉你「花了多少」。**

两个参考项目（vibe-usage、tokei）都只有 B 层，因为记账工具不需要实时性。Maclawd 是
要做出反应的角色，A 层是它和记账工具的根本区别。

### 降级链

| 条件 | 行为 |
| --- | --- |
| hook + tail + 扫描 | 完整体验 |
| **默认态**（未装 hook） | 状态从 token 速率推断，可区分 working/idle，无法区分 thinking/delegating/compacting |
| 无 `~/.claude` | 纯 idle + 交互动作，桌宠仍然可用 |
| **主开关关闭** | 同上——与「无数据」走**同一条**降级路径 |

hook 是增强，不是依赖。

「用户关闭」与「没有数据」必须复用同一条代码路径，不做两套逻辑。这既减少分支，
也保证关闭后的桌宠行为是已经被测试过的状态，而不是一个只在关闭时才会走到的
未验证分支。

---

## 统计合同

参考 vibe-usage 与 tokei 的逻辑，逐项择优。两者的详细差异见本文末尾附录。

### 1. 数据源

口径合同以 Claude Code 为基准表述；其余工具由各自解析器在**边缘**归一到同一形状
（已实现 Codex CLI、WorkBuddy、Kimi Code、Qwen Code、Grok Build，见文末「实现现状」）。

Claude Code 只认 `~/.claude/**/*.jsonl` 中满足全部条件的行：

- `type === "assistant"`
- `message.usage` 存在
- `timestamp` 可解析

**扫描根目录**（取 vibe-usage 的做法）：

```
~/.claude
$CLAUDE_CONFIG_DIR
所有含 projects/ 的 ~/.claude-*
→ 按 realpath 去重
```

Maclawd 是登录项/Finder 启动的 GUI 进程，读不到用户 shell 的环境变量。只扫
`~/.claude/projects` 会让多 profile 用户的数据静默消失。

同一 session id 出现在多个 root 时，按 `size → mtime` 选**最完整的一份**，不求和。

### 2. 五字段口径

Claude Code 的三类输入 token 互斥，不存在包含关系。

| 字段 | 来源 |
| --- | --- |
| `input` | `usage.input_tokens` |
| `output` | `usage.output_tokens` |
| `cache_read` | `usage.cache_read_input_tokens` |
| `cache_write` | `usage.cache_creation_input_tokens`，缺失时用 `cache_creation.ephemeral_5m + ephemeral_1h`；两者都有取 `max()` 防重复 |
| `reasoning` | 恒为 0（Claude Code 日志不单独上报） |

不做归并。vibe-usage 把 `cache_write` 折进 `input` 之后，缓存命中率就永久算不出来了。

存储时 `cache_write` 再按 TTL 拆成 `write5m` / `write1h` 两档，因为两档单价不同
（1h 是 2× 输入价）。展示时合并回一个「缓存写」即可。

### 3. 两个总量口径，都要存

```
billable   = input + cache_write + output          # 近似计费量
throughput = input + cache_write + output + cache_read   # 上下文吞吐量
```

长会话里 `cache_read` 常占 80% 以上，两个口径能差好几倍。**面板默认显示 `billable`，
悬停或展开显示 `throughput`。** 任何对外的数字必须标注口径。

缓存命中率：

```
hit% = cache_read / (cache_read + cache_write + input) × 100
```

### 4. 去重合同

取 tokei 的两层结构——它防的是 API 流式重试，比 vibe-usage 的单层 uuid 去重更强。

```
主键：(message.id, requestId)
次键：uuid                    # 仅当 message.id 缺失
特例：同 message.id、不同 requestId，且任一方 isSidechain → 视为重复合并
```

冲突时保留优先级（依次比较）：

1. 非 sidechain 优先于 sidechain
2. `throughput` 大者优先
3. 先出现者优先（保证确定性）

**执行两遍**：解析每个文件时先文件内去重，全部文件解析完后再跨文件去重一次。
跨文件那遍是必要的——fork 与 subagent 会把父会话记录复制到新文件。

### 5. 模型名

- `<synthetic>` 单独成类，计价为 0，**不向前结转**。vibe-usage 的 `lastModel`
  结转会在模型切换边界把 token 记到错误的模型头上。
- 归一化到 canonical id 后查价。**未知模型不猜价格**，如实报告「有多少 token 未能
  计价」并列出模型名。tokei 对未知模型按最贵的 Opus 兜底以求保守，但那会编出一个
  看起来精确、实际无依据的数字；对桌宠来说「这部分没算」比「可能是 $12.34」更可用。

### 6. 项目归属

- 取该 session 文件内**第一条**非空 `cwd`，末段目录名作为项目名。
- 之后 Claude 执行 `cd` 不改变归属，整个 session 归一个项目。
- 兜底：从 `~/.claude/projects/<encoded-path>` 的目录名反推。

### 7. 读取安全

1. 先 `stat` 取 size，**只读到该 size**，避免读到正在追写的半截行。
2. 逐行 JSON 解析失败静默跳过，不让一行坏数据带掉整个文件。
3. 解析前先做裸子串过滤——极便宜，能滤掉绝大多数行。过滤器由各解析器自己声明，
   可以是子串或谓词。**例外**：Claude Code 不过滤（`lineFilter = null`），因为会话
   时长需要 user / tool_use / tool_result 行的时间戳，而那些行没有 `usage`。

### 8. 时间归类

- 用记录自身的 `timestamp`，转**本地时区**后归入日期与小时。
- 只预聚合到「日」，7 个区间（今天/昨天/本周/上周/本月/今年/全部）**读时计算**。

tokei 预存 7 个区间，但 days 最多 365 条，读时算的开销可以忽略，且不存在跨天
边界的失效问题。这里比 tokei 简化。

---

## 存储契约

```
~/Library/Application Support/Maclawd/
├── usage/
│   ├── rollup.json          # 日聚合，权威数据
│   ├── scan-cache.json      # 每文件 mtime:size → 已解析事件（可删）
│   ├── tail-state.json      # 每文件 offset（可删）
│   ├── pricing.json         # 价格表
│   └── pricing.overrides.json   # 本地修正，更新价格表不覆盖
└── events.sock              # hook 写入器的 Unix domain socket
```

`rollup.json` 形状（`bucket` = `{input, output, cacheRead, write5m, write1h, reasoning}`）：

```json
{
  "v": 1,
  "days": {
    "2026-07-30": {
      "hours": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "sources": {
        "claude-code": {
          "input": 0, "output": 0, "cacheRead": 0, "write5m": 0, "write1h": 0, "reasoning": 0,
          "models":   { "<model>":   "<bucket>" },
          "projects": { "<project>": "<bucket>" }
        }
      }
    }
  },
  "sessions": {
    "claude-code": [
      { "firstTs": 0, "lastTs": 0, "activeSeconds": 0, "durationSeconds": 0,
        "messageCount": 0, "userMessageCount": 0, "userPromptHours": [], "project": "" }
    ]
  }
}
```

`hours[24]` 是跨 source 汇总的吞吐量，用于作息分析——Maclawd 判断「该睡了」的依据之一。

**不存成本。** 只存分模型的 token 明细，成本在读取时按当前价格表推导，
价格表更新自动修正全部历史，不需要 tokei 那样的 `_recalc_costs` 重算过程。

**会话指标与日聚合分开存。** 一个会话可能跨天，按日切分会把 `activeSeconds` 算错；
区间过滤在读取时按 `firstTs` / `lastTs` 做。

---

## Hook → 动作映射

Claude Code 提供 31 个 hook 事件。下表是 v1 需要订阅的子集。

**实施前必须按当时的官方文档逐项复核字段名，不要照抄此表。**

### 主状态与生命周期

| Hook 事件 | 动作 id | 动作名 |
| --- | --- | --- |
| `SessionStart` | `launching` | Hello Unfold |
| `UserPromptSubmit` | `thinking` | Puzzle Turn |
| `SubagentStart` / `SubagentStop` | `delegating` | Parcel Stack |
| `PreCompact` / `PostCompact` | `compacting` | Suitcase Fold |
| `PermissionRequest`、`Notification[permission_prompt]` | `needs_owner` variant=permission | Stuck Jar |
| `Notification[idle_prompt]` | `needs_owner` variant=question | Stuck Jar |
| 权限获得批准后 | `owner_resolved` | Jar Click |
| `Stop` | `success` | Self High-five |
| `StopFailure[rate_limit\|overloaded\|…]` | `error` | Basket Rescue |
| 错误状态解除 | `recovering` | Basket Breakout |
| `CwdChanged` | `workspace` | Workspace Folder |
| `TeammateIdle` | `waiting` | Claw Tap Wait |
| `SessionEnd` | `quitting` 或 → `away` | Goodbye Tuck |
| 全部 session 静默超过阈值 | `away` → `sleeping` | Blanket Tug → Top-down Sleep |

`needs_owner` 的三个 variant 是 `["permission", "question", "unknown"]`，
`PermissionRequest` 与 `Notification` 的 matcher 正好覆盖前两个。

`delegating` 的两个 variant 由并发 `agent_id` 计数决定：1 个为 `one-subagent`，
≥2 个为 `two-or-more-subagents`。

### 工作修饰

主状态契约要求：**详细工作修饰必须有可靠外部事件，否则回落 Tile Stack。**
`PreToolUse` 的 `tool_name` 就是那个可靠事件。

| `tool_name` | 动作 id | 动作名 | 可靠性 |
| --- | --- | --- | --- |
| `Read` / `Grep` / `Glob` | `working.reading` | Pocket Book | 可靠 |
| `Write` / `Edit` / `NotebookEdit` | `working.writing` | Letter Note | 可靠 |
| `WebFetch` / `WebSearch` | `working.syncing` | Spool Sync | 可靠 |
| `Bash` + 高置信构建命令 | `working.building` | Block Stack | 启发式 |
| `Bash` + 高置信测试命令 | `working.testing` | Toy Check | 启发式 |
| `Bash` + 高置信 git/网络命令 | `working.syncing` | Spool Sync | 启发式 |
| 其他一切 | `working` | Tile Stack | 兜底 |

Bash 的三分类需要看 `tool_input.command`。按契约精神，**只有匹配到高置信度模式
才升级到具体修饰，否则老实回落 Tile Stack**。command 字符串只用于正则分类，
不落盘（原则 2）。

### hook 未覆盖的动作

以下动作由 Mac 应用自身的输入与系统事件驱动，与本方案无关：
`interaction.*`、`ambient.edge`、`ambient.low_battery`、`moving`、`paused`、
`idle.grooming` / `idle.leg_shuffle` / `idle.drowsy`、`interaction.hover`。

已知缺口：`cancelled`（Tiny Shrug）需要「可靠的取消事件」，当前 hook 集里没有
直接对应项。暂时不接，保持动作待用。

### hook 写入器契约（已实现）

1. **以 `async: true` 注册。** 这是机制而不是自律——Claude Code 根本不等 hook 返回。
   原先只写「预算 15ms」是**承诺**，`async` 才是**保证**。实测单次 77ms（含 node 启动），
   在 async 下对 agent 完全无感。
2. **命令原文永不离开写入器进程。** Bash 的 `tool_input.command` 在写入器里就地分类成
   building / testing / syncing，发出去的是**类别**不是命令。
   这比「发出去再脱敏」强一个量级——原文根本不过边界。
3. **白名单提取。** 只挑 session_id / tool_name / agent_id / matcher 等元数据；
   新版本 Claude Code 往载荷里加什么字段都不会意外泄出去。
4. Maclawd 未运行时**立即静默退出，退出码 0**。hook 的错误会污染 agent 输出。
5. 安装严格对称：先备份、原子写、卸载只移除自己写入的条目，
   用户和别的工具的 hook 一个都不碰。
6. **只订阅状态事件**，不注册任何会拦截权限的 hook（见下）。

```bash
maclawd-usage hook install     # 13 个状态事件
maclawd-usage hook status
maclawd-usage hook uninstall
```

### 权限通道（已实现，默认关闭）

安装是**独立于状态 hook 的一步**：状态订阅是无害的旁观，拦截权限是介入
别人的决策流程，两者是性质不同的授权。面板上的 `permissionBubble` 开关
直接驱动 `type: "http"` hook 的注册与移除。


状态是**单向通知**，权限是**双向请求**——Claude Code 用 `type: "http"` hook 发来请求
并**等待返回**。三条安全底线：

1. **沉默等于不干预。** 超时、通道关闭、Maclawd 重启，一律返回空对象，
   把决策权原样交回 Claude Code 自己的确认流程。**绝不自动允许，也绝不自动拒绝。**
2. **默认整个通道关闭**，且安装是独立一步。拦截别人的权限流程是很重的行为。
3. **展示前脱敏**，且只保留摘要字段，原始载荷不留。

### 价表缓存与用户数据分离

`pricing.json` 是可重取的缓存，`rollup.json` / `settings.json` 是不可替代的用户数据。
把缓存放进用户数据目录，会让「换数据目录」或「清理用户数据」顺手把价表弄丢——
实测撞到过，表现是覆盖率从 97.8% 掉回 10%。所以价表存在独立的缓存目录，
而 `pricing.overrides.json`（用户手写的修正）仍属用户数据。

### 实测发现并修掉的两个问题

**`PostToolUse` 会抹掉工作修饰。** 工具往往几百毫秒就结束，`PostToolUse` 紧跟
`PreToolUse` 到达并把状态重置回通用 `working`，于是「正在读文件 / 正在同步」这些
具体修饰只闪一下，人眼根本看不到——等于 5 个工作修饰动作白画。
改成保留当前修饰，让它自然被下一个 `PreToolUse` 替换。

**状态切得比动作时长还快。** 动作契约给每个动作锁了 `durationMs`，
切换快于它就永远看不完一个完整循环。加了最小驻留：同级或更低优先级的状态
要等驻留期满才能顶掉当前状态；**要人决定、出错这类高优先级永远可以立刻抢占**——
让用户多等一秒才知道卡住了是不可接受的。

---

## 状态仲裁

一台机器可能同时跑多个 Claude Code 会话，但桌宠只有一只。

**每个 `session_id` 维护独立状态机**，桌宠显示所有活跃 session 中优先级最高的状态；
同优先级取最近事件。session 静默超过阈值后退出活跃集。

优先级（高 → 低）：

```
1  needs_owner      要人做决定，最高
2  error
3  compacting
4  delegating
5  working.<modifier>
6  working           通用兜底
7  thinking
8  idle
9  away → sleeping
```

一次性动作（`success`、`owner_resolved`、`recovering`、`launching`、`quitting`）
为 oneshot，插入播放完毕后回到当前最高优先级的循环态。

这就是 PROGRESS.md 阶段一所列的「状态优先级、打断、转场、回落规则」。

---

## 实时强度通道

- 内存环形缓冲，保留最近 5 分钟的 `(timestamp, throughput 增量)`。
- `tokens/min` = 窗口内求和 ÷ 窗口分钟数。
- offset 跟读：每文件维护 `{path, inode, offset}`。
  - 首次见到某文件时 `offset = 当前 size`，即**只算新增，不回溯**（历史由 B 层扫描负责）
  - `size == offset` → 无变化，跳过
  - `size < offset` → 截断或轮转 → 重置为 0
  - inode 变化 → 视为新文件

### 强度如何表达（待决）

tokcat 用 RunCat 模型：把负载映射成 2fps（空闲）到 40fps（满载）的帧间隔，直接
改动画速率。

但 Maclawd 的主状态契约**锁定了每个动作的 `durationMs`**（idle 5600ms、working
3400ms……）。改播放速率就违反了这份契约。三个选项：

| 选项 | 代价 |
| --- | --- |
| A. 只用强度选择状态与变体，不改速率 | 保守，完全不动契约，但强度表达弱 |
| B. 允许有界速率缩放（如 0.8×–1.3×），写进契约新增条款 | 表达力好，需要修改动作契约 |
| C. 自由速率缩放 | 违反契约，不考虑 |

**建议 A 起步，B 作为可选开关默认关闭。** 这是设计决策不是工程决策，需要动作契约
的所有者拍板。

---

## 性能预算

| 项 | 预算 |
| --- | --- |
| 冷启动全量扫描 | < 1.5s（首次视日志量可能更久，需显示进度） |
| 稳态刷新（缓存命中） | < 50ms |
| 实时 tail | < 5ms/次，每秒一次 |
| hook 写入器 | < 15ms |
| 空闲 CPU | < 1% |
| 常驻内存 | < 50MB |

tokei 有一次 6.5s → 0.6s、CPU 22% → 1% 的优化，主要来自 `mtime:size` 解析缓存与
裸子串预过滤。这两条从第一天就要做进去，不要事后补。

---

## 实施阶段

阶段 0–4 全部不需要 Swift，可以在当前仓库里用 Node 跑通，阶段 4 直接复用
`index.html` 当调试台。整条数据链路与状态机在写任何 Mac 应用代码之前就是活的。

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **0** | 口径验证脚本：扫真机日志，同时输出 `billable` / `throughput` / 命中率 | 数字能与 tokei、ccusage 对账，差异可解释 |
| **1** | 采集器：多 root 发现 + 快照读 + 两级去重 + `mtime:size` 缓存 + `rollup.json` 落盘 | 全量扫描 < 1.5s，稳态 < 50ms |
| **2** | 实时 tailer：offset 跟读 → `tokens/min` | 打印实时速率，与 Claude 实际在跑对得上 |
| **3** | hook 安装器 + 事件接收器 + 状态机 | 手动跑一轮 Claude，状态序列合理 |
| **4** | 状态机驱动 38 个动作，接进 `index.html` | 浏览器里的桌宠跟着真实 Claude 动 |
| **5** | Swift 菜单栏外壳接管渲染 | 阶段二的事 |

## 待决事项

1. **动画速率缩放是否允许**——违反 `durationMs` 契约，需设计所有者拍板（见上）。
2. **是否显示成本**——引入价格表就要承担维护负担。不做成本则只显示 token。
3. **是否扩展到其他工具**——v1 只做 Claude Code。其他工具没有 hook 通道，只能退化
   成轮询记账，会把 A 层的价值稀释掉。

---

## 附录：tokei 与 vibe-usage 的统计差异

两者都读同一份 Claude Code 日志，但回答的不是同一个问题：vibe-usage 是记账后端的
采集器（30 分钟一次，聚合与成本在云端），tokei 是本地面板的采集器（30 秒刷新，
全部本地算完）。几乎所有差异都能从这一条推出来。

| 维度 | vibe-usage | tokei | 本方案取 |
| --- | --- | --- | --- |
| 扫描范围 | `~/.claude` + `$CLAUDE_CONFIG_DIR` + 全部 `~/.claude-*`，含 `transcripts/` | 仅 `~/.claude/projects`，硬编码单路径 | vibe-usage |
| 字段 | 4 个，`cache_write` 并进 `input` | 5 个全拆开 | tokei |
| 总量口径 | `input + cache_write + output`，**不含 `cache_read`** | 四项全加，**含 `cache_read`** | 两个都存 |
| 缓存写 TTL | `max(总量, 5m+1h)` 防重复，仅用于计数 | 计数用总量；成本按 5m/1h 分档计价 | 两者结合 |
| 去重键 | 单层，日志行 `uuid`，取 usage 最大 | 两层，`(message.id, requestId)` + `uuid` 次键，sidechain 感知 | tokei |
| 防的重复 | 同 uuid 被复制到别的 session 且 usage 归零 | **API 流式重试**（同 message.id、不同 requestId） | tokei（更强） |
| sidechain | 完全不读 `isSidechain` | 读，作为去重优先级 | tokei |
| `<synthetic>` | 跳过，用 `lastModel` 向前结转 | 单独成类，不结转 | tokei |
| 零用量记录 | 直接丢弃 | 保留 | tokei |
| 时间归类 | 30 分钟 bucket，UTC | 本地日期，预聚合 7 区间 + `hours[24]` | tokei，但只聚合到日 |
| 增量策略 | **无缓存，每次全量重读**；增量只在上传前比对 hash（省网络不省磁盘） | **`mtime:size` 签名缓存已解析事件** + 裸子串预过滤 | tokei |
| 读取安全 | 快照 size 有界读，防半截行 | 直接读到底，靠 size 变化下次重解析自愈 | vibe-usage |
| 成本 | 本地不算，服务端算 | 本地三级价表 + TTL 分档 + 价表更新后重算 | tokei |
| 会话时长 | **完整**：`activeSeconds`（排除排队/TTFT）、`durationSeconds`、`userPromptHours[24]` | 无对应物 | vibe-usage |

### 最容易踩的坑

**两者报出的「总 token」不是同一个数**，差的就是 `cache_read`。长会话里
`cache_read` 常占 80% 以上，所以同一份日志两个工具可能差好几倍。两个都没错：
vibe-usage 报的接近真实计费量，tokei 报的是上下文吞吐量。

本方案两个都存、都标注口径，就是为了避免这个混淆。

### 各自明显更强的地方

vibe-usage 更强：多 root 发现（tokei 会漏掉多 profile 用户）、会话时长模型
（`activeSeconds` 那套算轮逻辑 tokei 完全没有）、读取边界严谨性。

tokei 更强：去重层级、增量性能、字段拆分（能算命中率）、本地成本估算。

结论：采集器骨架取 tokei，补上 vibe-usage 的多 root 发现、快照读取与会话时长
模型——这三块是 tokei 的缺口。

### 参考项目

| 项目 | 形态 | 许可 | 借鉴点 |
| --- | --- | --- | --- |
| [vibe-usage](https://github.com/vibe-cafe/vibe-usage) | Node CLI + 云端 | MIT | 统计语义、多 root 发现、会话时长 |
| [tokei](https://github.com/cclank/tokei) | Swift 菜单栏 + Python 采集 | MIT | 增量缓存、聚合形状、三级价表 |
| [tokcat](https://github.com/handlecusion/tokcat) | Tauri 2（Rust + React） | MIT | offset tail、`tokens/min` → 动画速率 |

本方案只参考逻辑，不复制代码。三个项目均为 MIT，Maclawd 为 all rights reserved；
若将来确实引用了代码片段，需为该部分保留 MIT 声明。


---

## 实现现状

阶段 0–3 已完成并在真机验证。桌宠接入（阶段 4）待状态集稳定。

### 代码结构

```
src/runtime/
  paths.js          数据目录（MACLAWD_DATA_DIR 可覆盖）
  store.js          原子 JSON 读写（临时文件 + rename）
  read-lines.js     有界行读取、尾部指纹、换行边界
  claude-roots.js   多 root 发现
  usage-record.js   规范化口径 + 两条不变量 + 累加桶
  dedupe.js         两级去重（source 隔离）
  parser-kit.js     解析器接口 + statelessParser
  scan.js           三级读取扫描器 + 工作预算
  sessions.js       activeSeconds 增量累加器
  rollup.js         日聚合 + 7 区间 + 个人基线
  tail.js           实时速率 + 强度映射
  pricing.js        三级价表，未知模型不猜价
  parsers/{claude-code,codex,workbuddy,kimi-code,qwen-code,grok}.js
bin/maclawd-usage.js   doctor / verify / scan / stats / watch
test/                  73 个测试
```

### 真机实测（6 款工具，约 7GB 日志，1295 个文件）

| 工具 | 记录数 | billable | throughput | 两口径倍数 | 命中率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Codex CLI | 74,647 | 468.95M | 9.85B | 21.0× | 96% |
| Claude Code | 11,766 | 74.47M | 1.87B | 25.2× | 97% |
| Kimi Code | 1,582 | 8.10M | 192.90M | 23.8× | 97% |
| Qwen Code | 339 | 2.01M | 64.04M | 31.8× | 98% |
| Grok Build | 42 | 1.54M | 15.55M | 10.1× | 91% |
| WorkBuddy | 2 | 37.4K | 68.9K | 1.8× | 47% |

**两口径倍数普遍在 20× 以上**，远超设计阶段预估的「好几倍」。任何对外的 token 数字
都必须标注口径，否则差的不是零头而是一个数量级。

性能：冷建 **26s** → 热启 **0.5s**，解析缓存 17MB。

### 与设计的三处偏差

**1. Codex 重放去重改用快照键，未采用序列匹配。**
设计时预留了「第二级不够再上 vibe-usage 的 payload 指纹序列匹配」。实测发现不需要：
`(total_token_usage, last_token_usage)` 全字段指纹作为去重键，交给通用去重器即可。
一次 fork 实测折叠了父会话 510 条中的 **493 条**，避免重复计 1.85M billable /
64.27M throughput。这个方案不需要读父文件、不需要维护重放索引。
全零快照没有区分度，退回文件内唯一键，避免跨文件误合并。

**2. 缓存写按 TTL 拆成两档存储，成本改为读取时推导。**
存 `write5m` / `write1h` 而非合并的 `cache_write`，因为两档单价不同（1h 是 2× 输入价）。
由此成本可以在读取时按当前价格表算出来，价格表更新自动修正全部历史——
不需要 tokei 那样的 `_recalc_costs` 重算过程。`rollup.json` 因此不存成本。

**3. 会话指标与日聚合分开存储。**
一个会话可能跨天，按日切分会把 `activeSeconds` 算错。区间过滤在读取时按
`firstTs` / `lastTs` 做。

### 实现中发现的坑

- **Kimi Code 双计**：`step.end` 与 `usage.record` 携带**完全相同**的四个数字，
  两者都收就整体翻倍。取 `usage.record`（它自带 model）。
- **WorkBuddy 去重键**：顶层 `id` 在同一轮的多条记录间重复（`gen-…`），
  只有 `providerData.messageId` 唯一。tokei 是 `id` 优先，会少算。
- **Codex 预过滤**：不能只匹配 `"token_count"`——工具输出正文里出现过
  `original_token_count`，在 290MB 文件上误命中的 `JSON.parse` 开销可观。
  实际匹配 `"total_token_usage"` / `"session_meta"` / `"turn_context"` 三者。
- **Claude Code 不做行过滤**：会话时长需要 user / tool_use / tool_result 行的时间戳，
  而那些行没有 `usage`。取 `activeSeconds` 的代价是全量 `JSON.parse`，
  实测冷建增加约 4 秒，可接受。

### 未实现的工具

OpenClaw、Gemini CLI、Hermes 在开发机上**没有用量数据**（OpenClaw 无 `agents/` 目录、
Gemini 无 `tmp/**/chats/`、Hermes 无 `state.db`），因此没有写解析器——
写无法针对真实数据验证的解析器，比不写风险更高。等拿到样本再补，解析层已经就位。

### 价格表：自动适配，不手工维护

**新模型不需要改代码。** 解析层把模型名当不透明字符串处理，token 计数、去重、
聚合、项目归属全都与模型名无关；只有**计价**需要知道单价。

计价改为拉取 OpenRouter `/api/v1/models`（367 个模型），它的 pricing 字段与本项目
五档口径一一对应，还带 272K 高上下文的 `overrides` 分档：

```
prompt → input                completion → output
input_cache_read → cacheRead
input_cache_write → write5m   input_cache_write_1h → write1h
```

配合名称归一化（去 provider 前缀、去日期后缀、版本 `-` 换 `.`、去产品档位后缀），
实测效果：

| | 未计价量 | 按 token 量覆盖率 |
| --- | ---: | ---: |
| 内置家族关键词表 | 10.82B | **10%** |
| 拉取 OpenRouter 后 | 265.57M | **97.8%** |

`claude-fable-5`、全部 `gpt-5.x`、`grok-4.5-build` 都自动命中——这些正是手工关键词表
漏掉的。成本从 $3020 修正为 $9789（此前九成用量根本没计价）。

三层查价，越靠前优先级越高：

```
1. pricing.overrides.json   手工修正，自动更新永不覆盖
2. pricing.json             拉取所得（用户显式触发）
3. 内置家族关键词            离线兜底，只覆盖 Anthropic 家族
```

**仍然坚持不猜价格。** 剩余 2.2% 是 `kimi-code/k3`、`qwen3.8-max-preview` 这类厂商
自有新模型——OpenRouter 与 LiteLLM（2984 条）都未收录。这些如实报告为未计价并列出
模型名，`pricing.overrides.json` 是逃生口。覆盖率指标让缺口可见，而不是藏进一个
看起来精确的总额里。

更新价格表是本项目**唯一**的对外请求（不可变原则 1 的既定例外）：一个公开 GET，
不携带任何用户数据，且必须用户显式触发，绝不在启动时自动发起。

### 另一条不依赖名称匹配的路

部分工具的日志里直接带成本，可以完全绕过计价：

| 工具 | 字段 | 状态 |
| --- | --- | --- |
| Grok Build | `costUsdTicks` | 已标定：**1 tick = 1e-10 USD**（1e-9/1e-8 分别差 10×/100×） |
| Kimi Code | 疑似 `amount` | 待查证 |
| Qwen Code | — | 确认无成本字段 |

Grok 现在已能通过后缀归一化命中价表，所以这条路不影响覆盖率，只影响准确度，
暂未实现。
