# vibe-usage 对标分析

**日期**：2026-08-14
**对标版本**：`@vibe-cafe/vibe-usage` v0.10.9
**Maclawd 解析器**：26 个（已与 vibe-usage 完全对齐）

---

## 一、工具覆盖差异

### Maclawd 有、vibe-usage 也有（21 个，全部覆盖）

claude-code、codex、workbuddy、kimi-code、qwen-code、grok、gemini-cli、
copilot-cli、pi-coding-agent、openclaw、amp、droid、cline、roo-code、
trae-cli、opencode、zcode、hermes、kiro、antigravity、cursor。

### ~~vibe-usage 有、Maclawd 没有（5 个）~~ → 已全部补齐

以下 5 个已在 `8c99611` 中实现并推送：

| 工具 | source id | 数据源 | 状态 |
| --- | --- | --- | --- |
| **Alma** | `alma` | SQLite | ✅ 已实现 |
| **CraftAgent** | `craft-agent` | JSONL（pi 同构） | ✅ 已实现 |
| **DimAgent** | `dimagent` | SQLite | ✅ 已实现 |
| **Oh My Pi (OMP)** | `omp` | JSONL（pi 同构） | ✅ 已实现 |
| **MiMoCode** | `mimocode` | SQLite | ✅ 已实现 |

### Maclawd 有、vibe-usage 没有

**无。** 两个项目现在完全对齐，都是 26 个解析器。

---

## 二、Token 口径对比

### 统一桶结构

| 字段 | Maclawd | vibe-usage |
| --- | --- | --- |
| 非缓存输入 | `input` | `inputTokens` |
| 输出（含推理） | `output` | `outputTokens`（**不含推理**） |
| 缓存读 | `cacheRead` | `cachedInputTokens` |
| 缓存写 5min | `write5m` | — 不分 TTL |
| 缓存写 1h | `write1h` | — 不分 TTL |
| 推理 | `reasoning`（是 output 的子计数） | `reasoningOutputTokens`（独立计数） |

### 核心差异：推理 Token 的归属

**这是两个项目最重要的口径分歧。**

| | Maclawd | vibe-usage |
| --- | --- | --- |
| **不变量** | output **含** reasoning，reasoning 只是展示用子计数 | output **不含** reasoning，两者独立 |
| **totalTokens** | input + output + cacheRead（reasoning 不重复加） | inputTokens + outputTokens + reasoningOutputTokens（**不含 cacheRead**） |
| **吞吐量** | input + write5m + write1h + output + cacheRead | 没有「吞吐量」概念，只有 totalTokens |
| **计费量** | input + write5m + write1h + output（不含 cacheRead） | 不做本地计费 |

**Maclawd 的选择更贴近 Anthropic/OpenAI 的原始计费结构**：推理按输出价计费，
放进 output 避免上下游重复计数。vibe-usage 把推理独立出来更直观，但下游做
`totalTokens = inputTokens + outputTokens + reasoningOutputTokens` 时，如果某个
解析器把推理同时算进了 output，就会双计。

### 逐工具口径差异

| 工具 | 差异点 | 影响 |
| --- | --- | --- |
| **Claude Code** | 两边都不单独上报 reasoning（Claude 日志里不分 reasoning） | 无差异 |
| **Codex** | Maclawd 用 `resolveInclusiveInput` 自动减缓存；vibe-usage 手动减 | 等价 |
| **Grok** | 两边都减缓存、reasoning 取 min(thinking, output) | 等价 |
| **Gemini CLI** | 两边都处理 thoughts 作子计数 | 等价 |
| **Copilot CLI** | Maclawd 手动减缓存，reasoning=0；vibe-usage 同 | 等价 |
| **Cursor** | Maclawd 走云 API CSV + 本地 SQLite 取 token；vibe-usage 同 | 等价 |
| **Amp** | 两边 reasoning=0，缓存写取 cacheCreationInputTokens | 等价 |
| **Droid** | 两边都减缓存、减推理 | 等价 |
| **Hermes** | Maclawd 把 reasoning **加进 output**（`output + reasoning`），符合不变量 2；vibe-usage 把 reasoning 独立 | **推理归属不同**，总量相同 |
| **Antigravity** | 同 Hermes——Maclawd 把 thinking 加进 output | **推理归属不同**，总量相同 |
| **Cline/Roo Code** | 两边 reasoning=0 | 等价 |
| **Kimi Code** | 两边 reasoning=0，字段直接映射 | 等价 |
| **OpenClaw** | reasoning 取 min(reasoning, output) | 等价 |
| **Trae CLI** | max-merge 同 traceID 的 spans | 等价 |
| **ZCode** | Maclawd 用 resolveInclusiveInput 自动判；vibe-usage 手动减 | 等价 |
| **WorkBuddy** | 多来源取最大值逻辑一致 | 等价 |

**结论：口径差异集中在 reasoning 归属上，只影响「输出 Token」和「推理 Token」
两个子指标的拆分，不影响总量。Maclawd 当前的处理方式更安全（不会双计）。**

### 缓存写 TTL 拆分

Maclawd 把缓存写拆成 `write5m` / `write1h`（两档单价不同），vibe-usage 合成
一个 `cacheCreationInputTokens`。这是 Maclawd 独有的精度，不需要对齐。

---

## 三、功能差异

### vibe-usage 有、Maclawd 没有

| 功能 | 说明 | 对 Maclawd 的价值 |
| --- | --- | --- |
| **云同步** | 压缩上传到 vibecafe.ai，增量同步 | Maclawd 定位是纯本地，**不需要** |
| **Codex 尾部缓存** | 记住上次读到的位置，下次只读增量（parsedBytes + guard hash） | **值得参考**。Maclawd 的 scan 目前每次全量读 |
| **Codex fork/replay 检测** | KMP 算法检测 token 指纹来排除 fork 子 agent 重放的历史 | **值得参考**。目前可能导致 Codex 数据偏高 |
| **Hostname 追踪** | 多机用户区分设备 | Maclawd 当前只追踪本机，design doc 已预留（`usage-analytics.md`） |
| **CLI skill 命令** | 往 AI 工具注入提示片段 | Maclawd 走 hook 安装，不需要 |
| **服务端定价** | 模型价格表在云端维护 | Maclawd 已有本地 pricing.js + 「更新价格表」按钮，**不需要** |

### Maclawd 有、vibe-usage 没有

| 功能 | 说明 |
| --- | --- |
| **本地成本估算** | pricing.js 维护价格表，查询时实时计算 |
| **缓存写 TTL 拆分** | 5min / 1h 两档，成本更精确 |
| **原生 macOS 面板** | SwiftUI 面板 + 桌宠 + 菜单栏 |
| **实时速率** | tail 追踪正在写入的 JSONL，1 秒级反馈 |
| **额度监控** | Claude Code / Codex / Cursor / Grok / WorkBuddy 订阅额度 |
| **桌宠状态** | 角色动画反映工作状态 |
| **会话管理** | 实时会话列表 + 活跃时长 |

---

## 四、下一步方案

### 优先级 1：补缺工具（工作量小，覆盖面提升明显）

#### 1a. MiMoCode（推荐优先）

**理由**：小米出品，国内用户基数相对大；SQLite 解析器 Maclawd 已有
（`src/runtime/parsers/sqlite.js` 是 Hermes/ZCode 等共用的基础设施）。

**实施**：
- 新建 `src/runtime/parsers/mimocode.js`
- 数据库位置：`~/.local/share/mimocode/mimocode.db`
- 参考 vibe-usage 的 `parsers/mimocode.js`：
  - 表 `messages`，字段 `input_tokens`, `output_tokens`, `cache_read_tokens`, `reasoning_tokens`
  - 口径：input 不含缓存（天然满足不变量 1），reasoning 加进 output（不变量 2）
- 预估工作量：半天

#### 1b. OMP / CraftAgent（可选）

**理由**：都用 pi 同构的 JSONL 格式，`pi-coding-agent.js` 的 `createFileParser`
已经是通用的，只需加目录发现逻辑。但用户极少，ROI 低。

**实施**：在 `pi-coding-agent.js` 旁边新建 `omp.js` 和 `craft-agent.js`，
复用同一个 `parseObject`，只改 `id`、`label`、`dataDirs()`。

#### 1c. Alma / DimAgent（可选）

**理由**：用户群体小，SQLite 解析，工作量不大但验证困难（没有真实数据）。
可以等有用户反馈后再加。

### 优先级 2：口径精修（不影响总量，但影响子指标准确性）

#### ~~2a. Claude Code 推理 Token~~ → 已完成

已在 `8c99611` 中预注册 `reasoning: toCount(usage.reasoning_tokens)`。
目前全是 0，一旦 Claude Code JSONL 开始携带该字段立即生效。

#### 2b. Codex fork/replay 检测

**现状**：Maclawd 的 Codex 解析器用 `total_token_usage` 差分避免累计值双计，
但没有检测 fork 子 agent 重放父 agent 历史的情况。

**影响**：如果用户频繁使用 Codex 的 fork 功能，重放的历史 token 会被重复计入，
导致用量偏高。vibe-usage 用 SHA256 token 指纹 + KMP 模式匹配来识别和排除。

**建议**：这是一个精度优化，不是 bug。可以等收到「Codex 数据偏高」的反馈后再做。
vibe-usage 的实现相当复杂（约 200 行），移植需要仔细验证。

### 优先级 3：扫描性能（中期）

#### 3a. 解析缓存 / 尾部缓存

**现状**：Maclawd 每次扫描都从头读所有文件。对于 Claude Code 这种可能有
几千个 JSONL 文件的目录，重复 IO 是浪费。

**vibe-usage 的做法**：
- 记住每个文件上次读到的字节位置（`parsedBytes`）
- 用 guard hash（文件头 + 尾各 512 字节的 SHA256）检测文件是否被覆写
- 下次扫描只读新增部分
- 每 30 天强制全量重读一次，防止静默漂移

**建议**：Maclawd 的 `daemon.js` 已经有 `createCollector` 做定时扫描，
但没有位置缓存。这是一个独立的性能优化，可以在用户反馈「扫描慢」时做。
目前实测扫描时间在秒级，还不是瓶颈。

### 不需要做的

| vibe-usage 功能 | 不做的理由 |
| --- | --- |
| 云同步 | Maclawd 定位纯本地，隐私是卖点 |
| Hostname 追踪 | 当前只追踪本机，多机同步是远期方向，design doc 已预留 |
| 服务端定价 | 本地价格表 + 手动更新已够用，且不依赖外部服务 |
| CLI skill 命令 | Maclawd 走 hook 安装，架构不同 |

---

## 五、验收标准（第一批）

如果决定做优先级 1a（MiMoCode），验收标准：

1. MiMoCode 安装后，`maclawd-usage probe mimocode` 能检测到数据
2. 统计页分布里显示「MiMoCode」（不是 `mimocode`）
3. 不变量检查通过（input 不含缓存、output 含 reasoning、吞吐 ≥ 计费）
4. `npm test` 全绿
5. 工具筛选菜单自动出现 MiMoCode 选项（这是上一个需求的自然延伸，无需额外代码）
