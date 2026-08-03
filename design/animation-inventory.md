# 动画素材总清单

**由 `scripts/build-inventory.mjs` 生成，请勿手改。**

与 [`/actions` 总表](https://maclawd.vercel.app/actions) 的区别：
总表列的是**契约里有哪些状态**，这里列的是**磁盘上有哪些文件**。
两者的差集恰恰是最容易出问题的地方——没人引用的素材会悄悄留着，
而契约引用了但文件不在的会白屏。所以差集单列一节。

素材文件 **66** 个 · 被契约引用 **49** 个 · 未引用 **17** 个 · 进了姿态谱（可生成变体）**64** 个

## 主状态（15）

| 素材 | 动作名 | 状态 id | 优先级 | mini 收敛 | 姿态谱 |
| --- | --- | --- | --- | --- | --- |
| `accordion-fold.svg` | Suitcase Fold | `compacting` | 3 | `mini.busy` | ✓ |
| `blanket-burrito.svg` | Top-down Sleep | `sleeping` | 10 | `mini.sleep` | ✓ |
| `blanket-drag.svg` | Blanket Tug | `away` | 9 | `mini.idle` | ✓ |
| `blanket-fold.svg` | Blanket Fold | `collapsing` | 9.5 | `mini.sleep` | ✓ |
| `blanket-pop.svg` | Morning Stretch | `waking<br>ambient.power_connected` | — | `mini.peek` | ✓ |
| `calm-calibration.svg` | Quiet Watch | `idle` | 8 | `mini.idle` | ✓ |
| `fading-watch.svg` | Fading Watch | `drowsing` | 8.5 | `mini.idle` | ✓ |
| `hatchling-parade.svg` | Parcel Stack | `delegating` | 4 | `mini.busy` | ✓ |
| `self-high-five.svg` | Self High-five | `success` | — | `mini.happy` | ✓ |
| `shell-shuffle.svg` | Puzzle Turn | `thinking` | 7 | `mini.busy` | ✓ |
| `stuck-jar.svg` | Stuck Jar | `needs_owner` | 1 | `mini.alert` | ✓ |
| `token-knitting.svg` | Tile Feed | `working` | 6 | `mini.busy` | ✓ |
| `work-tier2.svg` | Tile Feed ×2 | `working（≥2 档）` | 6 | `mini.busy` | ✓ |
| `work-tier3.svg` | Tile Feed ×3 | `working（≥3 档）` | 6 | `mini.busy` | ✓ |
| `yarn-tangle.svg` | Basket Rescue | `error` | 2 | `mini.error` | ✓ |

## 工作修饰（4）

| 素材 | 动作名 | 状态 id | 优先级 | mini 收敛 | 姿态谱 |
| --- | --- | --- | --- | --- | --- |
| `block-tower.svg` | Block Stack | `working.building` | 5 | `mini.busy` | ✓ |
| `wobble-test.svg` | Toy Check | `working.testing` | 5 | `mini.busy` | ✓ |
| `work-long.svg` | Deep Work | `working.long` | 5.8 | `mini.busy` | ✓ |
| `work-retry.svg` | Retry Grip | `working.retrying` | 4.8 | `mini.busy` | ✓ |

## 互动与环境（6）

| 素材 | 动作名 | 状态 id | 优先级 | mini 收敛 | 姿态谱 |
| --- | --- | --- | --- | --- | --- |
| `click-flinch.svg` | Poke Squish | `interaction.click` | — | `mini.peek` | ✓ |
| `drag-cling.svg` | Hanging Loop | `interaction.drag` | — | `mini.peek` | ✓ |
| `drop-wobble.svg` | Drop Wobble | `interaction.drop` | — | `mini.peek` | ✓ |
| `edge-peek.svg` | Curtain Peek | `ambient.edge` | — | `mini.idle` | ✓ |
| `low-battery-droop.svg` | Low Battery Droop | `ambient.low_battery` | — | `mini.alert` | ✓ |
| `surprised-hop.svg` | Surprised Hop | `interaction.double_click` | — | `mini.happy` | ✓ |

## 生命周期 / 生命感 / 自发（14）

| 素材 | 动作名 | 状态 id | 优先级 | mini 收敛 | 姿态谱 |
| --- | --- | --- | --- | --- | --- |
| `basket-breakout.svg` | Basket Breakout | `recovering` | — | `mini.busy` | ✓ |
| `claw-tap-wait.svg` | Claw Tap Wait | `waiting` | 4.6 | `mini.alert` | ✓ |
| `goodbye-tuck.svg` | Goodbye Tuck | `quitting` | — | `mini.enter` | ✓ |
| `hello-unfold.svg` | Hello Unfold | `launching` | — | `mini.peek` | ✓ |
| `hover-gaze.svg` | Cursor Gaze | `interaction.hover` | — | `mini.peek` | ✓ |
| `idle-claw-groom.svg` | Claw Groom | `idle.grooming` | — | `mini.idle` | ✓ |
| `idle-drowsy-nod.svg` | Drowsy Nod | `idle.drowsy` | — | `mini.idle` | ✓ |
| `idle-leg-shuffle.svg` | Leg Shuffle | `idle.leg_shuffle` | — | `mini.idle` | ✓ |
| `jar-click.svg` | Jar Click | `owner_resolved` | — | `mini.happy` | ✓ |
| `self-peek.svg` | Upward Peek | `self.peek` | — | `mini.peek` | ✓ |
| `self-roam.svg` | Little Wander | `self.roam` | — | `mini.walk` | ✓ |
| `self-stretch.svg` | Long Stretch | `self.stretch` | — | `mini.peek` | ✓ |
| `signal-listen.svg` | Signal Listen | `ambient.offline` | — | `mini.error` | ✓ |
| `statue-pause.svg` | Statue Pause | `paused` | — | `mini.idle` | ✓ |

## mini（贴边）（10）

| 素材 | 动作名 | 状态 id | 优先级 | mini 收敛 | 姿态谱 |
| --- | --- | --- | --- | --- | --- |
| `mini-alert.svg` | Edge Tap | `mini.alert` | — | — | ✓ |
| `mini-busy.svg` | Edge Bob | `mini.busy` | — | — | ✓ |
| `mini-enter.svg` | Tuck In | `mini.enter` | — | — | ✓ |
| `mini-error.svg` | Edge Slump | `mini.error` | — | — | ✓ |
| `mini-exit.svg` | Pop Out | `mini.exit` | — | — | ✓ |
| `mini-happy.svg` | Edge Bounce | `mini.happy` | — | — | ✓ |
| `mini-idle.svg` | Edge Doze | `mini.idle` | — | — | ✓ |
| `mini-peek.svg` | Edge Peek | `mini.peek` | — | — | ✓ |
| `mini-sleep.svg` | Edge Sleep | `mini.sleep` | — | — | ✓ |
| `mini-walk.svg` | Edge Shuffle | `mini.walk` | — | — | ✓ |

## 未被契约引用（17）

这些不是死文件——大部分是**等待挑选的候选**。
但它们不会被运行时播放，也不参与变体生成（给候选做变体是套娃）。

| 素材 | 标题 | 状态 class | 说明 |
| --- | --- | --- | --- |
| `inference-dial.svg` | Inference Dial | — | 早期概念稿，无 state class |
| `reasoning-gearbox.svg` | Reasoning Gearbox | — | 早期概念稿，无 state class |
| `work-b-stitch.svg` | Stitch Pair | `work-b` | 工作状态候选，见 /working-candidates |
| `work-c-stack.svg` | Stack Up | `work-c` | 工作状态候选，见 /working-candidates |
| `work-d-knead.svg` | Knead | `work-d` | 工作状态候选，见 /working-candidates |
| `work-e-haul.svg` | Full Haul | `work-e` | 工作状态候选，见 /working-candidates |
| `work-f-buried.svg` | Buried | `work-f` | 工作状态候选，见 /working-candidates |
| `work-g-carry.svg` | Head Carry | `work-g` | 工作状态候选，见 /working-candidates |
| `work-h-rain.svg` | Task Rain | `work-h` | 工作状态候选，见 /working-candidates |
| `work-i-hunch.svg` | Desk Hunch | `work-i` | 工作状态候选，见 /working-candidates |
| `work-j-tow.svg` | Tow Line | `work-j` | 工作状态候选，见 /working-candidates |
| `work-l-cycle.svg` | Full Cycle | `work-l` | 工作状态候选，见 /working-candidates |
| `work-n-split.svg` | Split Duty | `work-n` | 工作状态候选，见 /working-candidates |
| `work-o-keys.svg` | Keyboard | `work-o` | 工作状态候选，见 /working-candidates |
| `work-q-cards.svg` | Card Flip | `work-q` | 工作状态候选，见 /working-candidates |
| `work-r-pedal.svg` | Pedal | `work-r` | 工作状态候选，见 /working-candidates |
| `work-s-signal.svg` | Signal Relay | `work-s` | 工作状态候选，见 /working-candidates |
