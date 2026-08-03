# 形态盘点与缺口

> **状态：三个缺口已全部补齐**（41 → 48 个动作）。补齐后的实现见文末。

对照 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 做的一次全量清点，
以及由此定下的三个补齐方向。

清单**不是手抄的**：两边都从各自的契约里导出（它是 `themes/clawd/theme.json`，
我们是 `design/*.json`）。手抄的清单会漂移，而漂移之后它会变成一份
看起来权威、实际在骗人的文档。

---

## 一、两边现有什么

### clawd-on-desk — 25 个状态 / 36 个 SVG

**主状态 16**

| 状态 | 素材 | 语义 |
| --- | --- | --- |
| `idle` | idle-follow | 待机（眼睛跟光标） |
| `working` | working-typing | 干活 |
| `thinking` | working-thinking | 思考 |
| `juggling` | headphones-groove | 多线程 |
| `carrying` | working-carrying | 搬运 |
| `sweeping` | working-sweeping | 打扫 |
| `roam` | mini-crabwalk | 漫游 |
| `attention` | happy | 求关注 |
| `notification` | notification | 通知 |
| `error` | error | 出错 |
| `dizzy` | dizzy | 晕 |
| `yawning` | idle-yawn | 睡眠链 ① 打哈欠 |
| `dozing` | idle-doze | 睡眠链 ② 打盹 |
| `collapsing` | collapse-sleep | 睡眠链 ③ 倒下 |
| `sleeping` | sleeping | 睡眠链 ④ 睡着 |
| `waking` | wake | 睡眠链 ⑤ 醒来 |

**mini 9**：`mini-idle` · `mini-working` · `mini-peek` · `mini-alert` · `mini-happy` ·
`mini-sleep` · `mini-crabwalk` · `mini-enter` · `mini-enter-sleep`

**变体机制 3 类**

- 工作分档（按并发会话数）：≥1 typing / ≥2 headphones-groove / ≥3 building
- 杂耍分档：≥1 headphones-groove / ≥2 juggling
- idle 彩蛋（按时长排队）：idle-look 6.5s / idle-bubble 13.5s / idle-reading 14s
- 交互反应 5 种：drag / clickLeft / clickRight / annoyed / double

它的优先级**数字越大越优先**（error 8 最高，sleeping 0 最低），与我们相反。

### Maclawd — 41 个动作 / 59 个 SVG

**主状态 11**：`idle` · `thinking` · `working`（3 档分档）· `delegating` ·
`compacting` · `needs_owner` · `error` · `success` · `away` · `sleeping` · `waking`

**工作修饰 4**：`working.building` · `working.testing` · `working.retrying` · `working.long`

**互动与环境 6**：`click` · `double_click` · `drag` · `drop` ·
`ambient.edge` · `ambient.low_battery`

**生命周期与生命感 12**：`launching` · `quitting` · `waiting` · `paused` ·
`owner_resolved` · `recovering` · `hover` · `ambient.offline` ·
`ambient.power_connected`（别名）· idle 彩蛋 3 个

**mini 8**：`mini.idle` · `mini.busy` · `mini.peek` · `mini.alert` ·
`mini.error` · `mini.happy` · `mini.enter` · `mini.exit`

---

## 二、形态上的分野

**它演「桌宠的生活」，我们演「Agent 的状态」。**

它独有：roam（漫游）、sweeping（打扫）、juggling（杂耍）、dizzy（晕）、
carrying（搬运）、attention（求关注）——这些和 Agent 在干什么**无关**，
是宠物自己的行为。

我们独有：compacting、needs_owner / owner_resolved、waiting、
working.retrying / long / building / testing、recovering、
ambient.offline / low_battery——**全是 Agent 状态的细分**。

两边各自的强项是真的：它在**表演**上更丰富，我们在**信息**上更密。
但「更密」的代价是——我们现在更像一个会动的状态指示器，不太像一只宠物。

---

## 三、三个缺口

### 缺口 A：睡眠链太短（3 段 vs 5 段）

我们：`away`（拉毯子）→ `sleeping`（睡着）→ `waking`（起床）
它：`yawning` → `dozing` → `collapsing` → `sleeping` → `waking`

我们从「拉毯子」直接跳到「睡着」，**中间缺一个「撑不住了」**。
入睡是桌宠一天里最有戏的一段，现在被压缩掉了。

### 缺口 B：宠物自己什么都不做

41 个动作**全部**由 Agent 状态或用户操作驱动。宠物自己不会主动做任何事。

3 个 idle 彩蛋（擦爪、挪腿、打盹）勉强沾边，但那是「待机时的小动作」，
不是「它想干点什么」——区别在于**有没有目的**。擦爪是无聊时的抽动，
漫游是它决定去别处看看。

这是「桌宠」与「状态指示器」的分界线。现在我们在后者那边。

### 缺口 C：mini 档不能移动

贴边收起之后只能原地待着。它的 `mini-crabwalk`（横着走）让 mini 档
也有位移，而 `mini-enter-sleep`（贴边直接入睡）让睡眠链在 mini 档也成立。

我们的 mini 8 档里，`mini.error` 和 `mini.exit` 是它没有的；
缺的是**移动**与**mini 档的睡眠**。

---

## 四、补齐计划

### A. 睡眠链 3 → 5

| 新增 | 位置 | 语义 |
| --- | --- | --- |
| `drowsing` | idle 与 away 之间 | 眼皮开始打架，还撑着 |
| `collapsing` | away 与 sleeping 之间 | 撑不住了，倒下去 |

完整链：`idle` → **`drowsing`** → `away` → **`collapsing`** → `sleeping` → `waking`

已有的 `idle.drowsy`（Drowsy Nod）是 **idle 变体**，随机轮播、会自己醒回来；
新的 `drowsing` 是**转场**，只在真的要睡了才走，且不回头。两者不冲突。

### B. 宠物自己的行为（自发态）

判据：**必须由宠物自己发起，不对应任何 Agent 状态或用户操作。**

| 新增 | 触发 | 语义 |
| --- | --- | --- |
| `roaming` | 长时间 idle 后随机 | 沿桌面小范围溜达 |
| `stretching` | 长时间静止后 | 伸个懒腰 |
| `curious` | 桌宠附近有窗口变化时 | 探头看一眼 |

三个都必须**低频**且**可被任何真实状态立刻打断**——宠物的自娱自乐
不能盖住「Claude 卡住了」。所以优先级要低于 idle。

### C. mini 档补充

| 新增 | 语义 |
| --- | --- |
| `mini.walk` | 沿屏幕边缘横向移动 |
| `mini.sleep` | 贴边状态下入睡 |

`mini.walk` 需要外壳配合：mini 档下窗口沿边缘平移。
`mini.sleep` 让睡眠链在 mini 档也完整，否则贴边后睡着会突然弹回主形态。

---

## 五、不打算抄的

- **dizzy（晕）**——没有对应的真实信号，纯表演。加了就是为动而动。
- **sweeping（打扫）/ carrying（搬运）**——同上，且与 `working` 的道具语言冲突。
- **attention（求关注）**——桌宠主动要注意力这件事本身就该慎重。
  我们已经有 `needs_owner`，那是**有实际理由**的求关注。
- **它的 tier 映射**——机制已搬（见 `working.tiers`），但「戴耳机 = 2 个会话」
  这种对应关系用户读不出来，那是换皮不是传信息。


---

## 六、补齐结果

三个缺口全部实现，动作数 41 → 48。

### A. 睡眠链 3 → 5 段 ✅

`idle` → **`drowsing`**(Fading Watch) → `away` → **`collapsing`**(Blanket Fold)
→ `sleeping` → `waking`

时序用**比例**而不是绝对值（`drowsyRatio 0.7 × away`），这样 energy 低时
整条链一起缩短，「累的时候睡得早」才成立。

`collapsing` 承担的是构图过渡：此前 away（站着、毯子在身侧）到
sleeping（俯视平躺、盖着被）是硬切，毯子会瞬间从身侧跳到身上。

### B. 自发行为 ✅

| 动作 | 时长 | 特点 |
| --- | --- | --- |
| `self.stretch`（Long Stretch） | 3.2s | 顶点停住，落回比拉长慢 |
| `self.peek`（Upward Peek） | 2.8s | 视线朝**上**——不追光标，与 hover 相反 |
| `self.roam`（Little Wander） | 4.6s | **外壳真的把窗口平移 64pt** |

走 oneshot 插播而不是占仲裁档位——宠物的自娱自乐必须能被任何真实状态
立刻打断。energy > 0.35 才做，累了就不折腾。

`self.roam` 的位移是硬要求：原地走路是假的。退役掉的 `moving`
（Sideways Scuttle）就是因为外壳从不发 `shell.move`，那个动作一次都没上过屏。
所以计划里带 `drift`，外壳在动作时长内分帧平移，撞到屏幕边自然停下。

### C. mini 档 8 → 10 ✅

| 动作 | 说明 |
| --- | --- |
| `mini.walk`（Edge Shuffle） | 沿边缘**纵向**挪（贴的是左右边，所以沿边走是上下） |
| `mini.sleep`（Edge Sleep） | 眼睛全程闭死、缩得更紧——此前 sleeping 收敛到 Edge Doze，「真睡着」和「打盹」长得一样 |

### 过程中修的四处

1. **总表解析器第三、四次同类失配**。静默链改成三元表达式后 actionId
   不再是字面量，四个睡眠态一起被标成「没有触发源」；自发行为由 `SELF_ACTS`
   表驱动，是第四条不走 `s.state` 赋值的路径。靠的是总表测试当场炸掉。

2. **自发行为只 push 不 emit**。`pushOneshot` 后直接 `return current`，
   新动作要等下一次 resolve 才上屏，中间显示的还是上一个动作。

3. **生成器分工没划清**。`make-action-svgs.mjs` 用主形态取景把 mini 素材
   覆盖了，而覆盖后画面**看起来仍然正常**——只是角色缩在角落里。
   现在主形态生成器显式跳过 mini。

4. **mini 生成器没同步眼睛拆分**。`.eyes` / `.blink` 当初是用一次性脚本
   拆开的，生成器还是合并写法，重新生成时又被覆盖回去。
   同源的东西必须同源修——一次性脚本改过的地方，生成器也要改。
