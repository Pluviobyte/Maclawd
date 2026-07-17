# Maclawd 主状态动作圣经 v5

状态：12 个主状态已经完成「完整小场景」重设计，并在 64px 与 96px 下进行浏览器渲染审查。

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

## V5 场景可读性规则

1. 观看顺序固定为：熟悉场景 → 身体轮廓 → 真实接触 → 动作姿势。
2. 每个动作只使用一个场景家族，不混搭互不相关的功能物件。
3. 场景主体宽度通常只允许为原角色宽度的 `1.1–1.6×`；在 96px QA 图中，完整动作横向包围盒不得超过 `52px`。
4. Clawd 必须坐、躺、趴、抓、推或踩在场景物上；场景应贴身或纵向叠放，不能通过横向铺满画布来解释状态。
5. 双眼在关键语义帧必须可见；道具不得长期压住脸。
6. 禁止文字、UI 面板、漂浮标点、速度线、光晕、烟雾和阴影；`sleeping` 按用户明确要求保留硬边像素 `Zzz`，这是唯一例外。
7. 动作必须在 64px 与 96px 两档检查，不以大图好看代替桌宠尺寸可读性。

## 主状态总表

| 状态 | V5 动作 | 时长 | 场景策略 | 一眼读法 |
| --- | --- | ---: | --- | --- |
| `idle` | Cushion Watch | 5.6s | 一张大地面软垫 | 坐在垫子里安静观察 |
| `away` | Bedtime Pull | 3.8s | 俯视床铺与同一条毛毯 | 爬到床边把被子拉上来 |
| `sleeping` | Top-down Sleep | 6.4s | 俯视床垫、枕头、同一条毛毯与像素 Zzz | 整只平躺盖被，闭眼和双爪露出 |
| `waking` | Morning Stretch | 2.6s | 同一张床与毛毯 | 在床上伸展，被子滑向床尾 |
| `thinking` | Puzzle Pause | 4.6s | 一张地垫与一块大拼图 | 翻转最后一块，停住思考 |
| `working` | Desk Shuffle | 3.4s | 一张低木桌与两块工作牌 | 伏在桌前双爪交替推动 |
| `delegating` | Parcel Parade | 5.0s | 地面小路、一个包裹和两个助手 | 把包裹交给助手送走 |
| `needs_owner` | Picnic Jar | 4.8s | 餐垫与一个大玻璃罐 | 拧不开，推给主人 |
| `compacting` | Suitcase Fold | 4.8s | 打开的行李箱与大条纹布 | 把长内容逐折收进行李箱 |
| `workspace` | Mat Move-in | 4.2s | 一张横向拼布工作垫 | 铺开并搬进新的工作位置 |
| `success` | Cushion Cheer | 2.9s | 一张弹性软垫 | 踩垫起跳并在头顶击掌 |
| `error` | Basket Rescue | 4.8s | 一个大编织篮 | 被扣住、挣脱、又被碰倒 |

## 状态链与退出规则

- `away → sleeping → waking → idle` 共享同一张床、枕头、紫色毛毯和柔软配色；睡眠段保留俯视平躺与明确的 `Zzz`。
- `thinking → working` 共用地面工作区语言：前者是拼图地垫，后者是低桌，不会突然切回抽象机械图标。
- `working → needs_owner` 先停止 Desk Shuffle，再切到餐垫上的大罐子求助场景。
- `workspace` 与 `success` 为单次动作，结束后分别进入 `working` 与 `idle`。
- `error` 与 `needs_owner` 只由外部事件解除，不能自行宣告成功。
- 状态切换最多允许 `120ms` 透明度交叉淡入，不使用模糊或拖影。

## 文件兼容说明

V5 保留既有 SVG 文件名，避免后续运行时引用失效；文件内部标题、动作与合同均已替换。例如 `shell-shuffle.svg` 现在实现 **Puzzle Pause**，`token-knitting.svg` 现在实现 **Desk Shuffle**。旧视觉可在 Git 历史中查看，不在当前动作实验室展示。

机器可读合同见 [`main-state-actions.json`](main-state-actions.json)，生产源文件见 [`../src/animations/`](../src/animations/)。
