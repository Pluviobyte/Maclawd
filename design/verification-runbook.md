# 解析器运行态验证手册

**给谁看**：想帮忙验证 Maclawd 是否正确读取某个 AI 编程工具用量的人。

**为什么需要**：21 个解析器里只有 7 个用真实数据核对过口径。其余是照
vibe-usage 的实现移植的——**能跑通不等于算得对**。字段名对得上但语义搞反
（比如 `input` 到底含不含缓存）会产出看起来正常、实际差一个数量级的数字。
这类错误静态代码审查看不出来，只有拿真实日志跑一遍才会暴露。

---

## 三步走

```bash
# 1. 记录当前基线
node bin/maclawd-usage.js probe --save

# 2. 打开那个工具，做一次真实对话（见下面各工具的最小操作）

# 3. 看新增有没有被记到，以及是否通过不变量检查
node bin/maclawd-usage.js probe --diff
```

只想看有问题的：`probe --issues`。只看某一个：`probe kimi-code`。

### 输出怎么读

```
✓ 全部检查通过
! 需要你判断（多半是能力缺失，不一定是 bug）
✗ 确定有问题
· 未安装 / 没数据，跳过
```

`[已验证]` = 已用真实数据核对过口径；`[待验证]` = 移植而来，正等你验证。

---

## 不变量检查在查什么

每一条都来自本项目**踩过的真实坑**，不是凭空想的：

| 检查 | 查出来说明什么 | 现实来源 |
| --- | --- | --- |
| 有文件却 0 条记录 | 日志结构与解析器假设不一致 | — |
| `reasoning > output` | 该工具把推理与输出**分开**上报，解析器却当成包含关系（不变量 2） | Hermes、Antigravity 都是分开报的 |
| 吞吐 < 计费 | 缓存字段被算成负数，`input` 含不含缓存判断反了（不变量 1） | WorkBuddy / Codex / Gemini 的 input 含缓存，Claude / Kimi 不含 |
| 时间戳不合理 | 把秒当毫秒，或反过来 | Grok 用 epoch **秒**，WorkBuddy 两种都有 |
| 单条吞吐 > 50M | 该工具上报的是**累计值**，解析器没做差分 | Codex 的 `total_token_usage` 是累计的 |
| 去重折叠 > 50% | 去重键选得太粗，会**少算** | WorkBuddy 顶层 `id` 在同一轮内重复，只能用 `providerData.messageId` |
| 模型全是 unknown | 模型名提取没生效，成本算不出来 | — |
| 项目全是 unknown | 项目归属没生效 | OpenClaw 的 `workspaceDir` 在旁挂的 `.trajectory.jsonl` 里 |
| token 全为 0 | 字段名完全没对上 | — |

### 检查不了的那一类

**双计**。同一次模型调用被记两遍，所有不变量看起来都正常，总量却翻倍。
只能靠人工比对：

- **Kimi Code**：`step.end` 与 `usage.record` 携带完全相同的四个数字
- **OpenClaw**：`message` 与 `model.completed` 携带完全相同的 usage

这两个已经处理了。**如果你验证的工具日志里出现「同一次调用在两种记录类型里都有 usage」，
一定要反馈**——这是最危险也最难自动发现的一类错误。

---

## 各工具的最小验证操作

「最小操作」= 能产生一次真实模型调用的最短路径。问一句「你好」就够，
不需要真的干活。

| 工具 | 最小操作 | 日志落点 |
| --- | --- | --- |
| **Gemini CLI** | `gemini` 后问一句并**等它回答完** | `~/.gemini/tmp/<project>/chats/session-*.jsonl` |
| **GitHub Copilot CLI** | `copilot` 问一句，**然后正常退出**（用量只在会话结束事件里给出） | `~/.copilot/session-state/*/events.jsonl` |
| **pi** | `pi` 问一句 | `~/.pi/agent/sessions/<encoded-cwd>/*.jsonl` |
| **Amp** | 发一条消息 | `~/.local/share/amp/threads/T-*.json` |
| **Droid** | `droid` 问一句 | `~/.factory/sessions/<id>.jsonl` + `<id>.settings.json` |
| **Cline / Roo Code** | 在 VSCode / Cursor / Windsurf 里跑一个任务 | `<宿主>/User/globalStorage/<扩展>/…` |
| **Trae CLI** | 问一句 | macOS `~/Library/Caches/trae-cli/sessions/*/traces.jsonl` |
| **OpenCode** | 问一句 | `~/.local/share/opencode/opencode.db` |
| **ZCode** | 问一句 | `~/.zcode/cli/db/db.sqlite` |
| **Hermes** | 问一句 | `~/.hermes/state.db`（多 profile 在 `profiles/*/state.db`） |
| **Kiro** | 问一句 | `~/Library/Application Support/kiro-cli/data.sqlite3` |
| **Antigravity** | 对话一轮 | `~/.gemini/antigravity*/conversations/*.db` |
| **Cursor** | 需先在设置里开「Cursor 云端用量」（唯一联网解析器，默认关） | 云端 CSV，本地只存登录态 |

### 几个特别注意的

**Copilot CLI 必须正常退出。** 它的用量只在 `session.shutdown` 事件里一次性给出，
中途 kill 掉就什么都没有。

**Droid 需要两个文件。** 用量在旁挂的 `<id>.settings.json` 里，只有 `.jsonl` 不够。

**Cline / Roo Code 要遍历所有 VSCode 系宿主。** 很多人在 Cursor 或 Windsurf 里装 Cline，
只看 `Code` 会漏掉。验证时请说明你用的是哪个宿主。

**Antigravity 的字段号是逆向出来的。** 我加了结构自校验——解不出预期的嵌套就返回 null，
所以最可能的失败形态是「有文件但 0 条记录」，而不是数字错。这个尤其需要真实样本。

---

## 怎么反馈

贴这三样就够定位：

```bash
node bin/maclawd-usage.js probe <source>          # 1. 体检输出
node bin/maclawd-usage.js probe <source> --diff   # 2. 与操作前的差异
```

3. **一条脱敏后的原始日志样本**。这个最有价值——多数问题一看结构就明白。

> 贴样本前请自己过一眼：删掉 prompt 正文与任何密钥。
> 我们只需要**结构**（有哪些字段、嵌套关系、token 字段叫什么名），不需要内容。
> 数字可以改成假的，只要保持字段之间的**关系**（比如 total 是否等于 input+output——
> 这一条恰恰是判断 input 含不含缓存的关键依据）。

### 「数字对不对」怎么判断

如果那个工具自己有用量统计（很多 CLI 有 `/cost`、`/usage` 或状态栏），
拿它和 Maclawd 的 `probe` 输出对一下。注意**口径**：

- Maclawd 的 **计费量** = 输入 + 缓存写 + 输出（**不含**缓存读）
- Maclawd 的 **吞吐量** = 四项全加（**含**缓存读）

多数工具自己报的是吞吐量。实测两个口径能差 **20 倍以上**，
所以对不上时先确认是不是口径差异，再判断是不是 bug。

---

## 已知的能力缺失（不是 bug，不用反馈）

| 工具 | 缺什么 | 原因 |
| --- | --- | --- |
| Qwen Code | 项目归属 | `token-usage-*.jsonl` 里根本没有 cwd 字段 |
| Amp | 项目归属 | thread 文件里没有工作目录 |
| Gemini CLI | 项目归属 | `tmp/` 下是路径哈希目录，反推不出真实路径 |
| Kiro | 从正文估算 token 的那条路径 | **有意不实现**——估算值混进「计费量」会让这个口径失去意义 |
| Cursor | 本地用量 | 它本地只存登录态，用量全在云端 |

---

## 本手册自己是怎么来的

写完体检工具后在开发机上跑第一遍，**立刻查出 5 项**，其中：

- **2 项是真 bug**：Gemini 的 `$set.messages[]` 包装没处理（按每行一条消息解析，
  真实文件上一条都出不来）；OpenClaw 把嵌套在自己目录里的 Codex rollout 也扫了进去，
  且项目名在旁挂的 `.trajectory.jsonl` 里取不到
- **2 项是体检工具自己的误报**：按扩展名统计文件，把无关的 json 算进来，
  报出「326 个文件却只有 1 条记录」这种吓人但完全错误的结论
- **1 项是能力缺失**：Qwen 没有 cwd 字段

误报已经修掉了——**误报会浪费排查者的时间，比不报还糟**。
如果你遇到明显不对的判定，那也值得反馈。
