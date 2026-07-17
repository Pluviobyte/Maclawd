# Maclawd 主状态动作圣经 v4

状态：12 个主状态已经完成「身体优先」重设计，并在 64px 与 96px 下进行浏览器渲染审查。

## 不可变角色合同

| 部位 | 固定值 |
| --- | --- |
| 画布 | `viewBox="-15 -25 45 45"` |
| 身体 | `x=2 y=6 width=11 height=7` |
| 左/右爪 | `x=0/13 y=9 width=2 height=2` |
| 四条腿 | `x=3/5/9/11 y=13 width=1 height=2` |
| 双眼 | `x=4/10 y=8 width=1 height=2` |
| 身体 / 眼睛 | `#DE886D` / `#000000` |

允许对身体部件所在的 `<g>` 做离散位移、旋转和缩放；不允许改写源矩形、增加描边、渐变、软阴影或替代眼睛。

## V4 可读性规则

1. 观看顺序固定为：身体轮廓 → 姿势 → 必要时才看道具。
2. 每个动作最多一个主要道具；`delegating` 例外，可出现两个大助手。
3. 主要道具宽度应约为身体宽度的 `0.6–1.2×`，不能退化成脚边小色块。
4. 道具必须有熟悉轮廓，并与爪、身体或地面发生接触；不能漂浮解释状态。
5. 双眼在关键语义帧必须可见；道具不得长期压住脸。
6. 禁止文字、UI 面板、漂浮标点、速度线、光晕、烟雾和阴影。
7. 动作必须在 64px 与 96px 两档检查，不以大图好看代替桌宠尺寸可读性。

## 主状态总表

| 状态 | V4 动作 | 时长 | 道具策略 | 一眼读法 |
| --- | --- | ---: | --- | --- |
| `idle` | Calm Calibration | 5.6s | 无 | 清醒、放松、不打扰 |
| `away` | Blanket Drag | 3.8s | 一条大毛毯 | 犯困，把被子拖来 |
| `sleeping` | Blanket Rest | 5.8s | 同一条毛毯，只盖下半身 | 脸和爪露在外面睡觉 |
| `waking` | Blanket Wake | 2.6s | 同一整条毛毯滑向身后 | 从被子里弹起 |
| `thinking` | Claw Count | 4.6s | 无 | 左右数爪，停在决定姿势 |
| `working` | Busy Claws | 3.4s | 无 | 双爪交替忙碌并检查 |
| `delegating` | Helper Handoff | 5.0s | 两个身体近半宽的大助手 | 交接任务并送助手出发 |
| `needs_owner` | Jar Assist | 4.8s | 身旁一个大玻璃罐 | 拧不开，推给主人 |
| `compacting` | Pocket Fold | 4.8s | 一条大锯齿折页 | 长内容压成小折包 |
| `workspace` | Rollout Mat | 4.2s | 一张横向大工作垫 | 铺开一块新的工作空间 |
| `success` | Self High-five | 2.9s | 无 | 双爪在头顶真正碰到 |
| `error` | Failed Stand | 4.8s | 无 | 摇晃、倒下、爬起再倒 |

## 状态链与退出规则

- `away → sleeping → waking → idle` 共享同一条毛毯的紫色、浅折边和黄色流苏语言。
- `thinking → working` 都是无道具身体动作，可直接换节奏，不再先清场一堆小物。
- `working → needs_owner` 先停止 Busy Claws，再让大罐子从身体侧面进入。
- `workspace` 与 `success` 为单次动作，结束后分别进入 `working` 与 `idle`。
- `error` 与 `needs_owner` 只由外部事件解除，不能自行宣告成功。
- 状态切换最多允许 `120ms` 透明度交叉淡入，不使用模糊或拖影。

## 文件兼容说明

V4 保留既有 SVG 文件名，避免后续运行时引用失效；文件内部标题、动作与合同均已替换。例如 `shell-shuffle.svg` 现在实现 **Claw Count**，`token-knitting.svg` 现在实现 **Busy Claws**。旧视觉可在 Git 历史中查看，不在当前动作实验室展示。

机器可读合同见 [`main-state-actions.json`](main-state-actions.json)，生产源文件见 [`../src/animations/`](../src/animations/)。
