# Maclawd 主状态动作圣经 v5.3

状态：12 个主状态已从「完整小场景」收束为身体优先构图。除了俯视睡觉，横向底座已经移除。

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

## V5.3 身体优先规则

1. 观看顺序固定为：身体轮廓 → 身体动作 → 必要的一个贴身道具 → 场景语境。
2. 禁止地毯、桌面、路径、地台、软垫和横杆；`sleeping` 的俯视床铺是唯一完整底座。
3. 道具必须与身体重叠、贴在一侧或纵向叠放，不能再用“脚下铺一块东西”解释状态。
4. 不需要道具时直接做身体动作；`idle`、`success`、点击、双击、落地和低电量均为身体表演。
5. 双眼在关键语义帧必须可见；道具不得长期压住脸。
6. 禁止文字、UI 面板、漂浮标点、速度线、光晕、烟雾和阴影；`sleeping` 按用户明确要求保留硬边像素 `Zzz`，这是唯一例外。
7. 动作必须在 64px 与 96px 两档检查，不以大图好看代替桌宠尺寸可读性。

## 主状态总表

| 状态 | V5 动作 | 时长 | 场景策略 | 一眼读法 |
| --- | --- | ---: | --- | --- |
| `idle` | Quiet Watch | 5.6s | 无道具 | 安静呼吸、观察、眨眼 |
| `away` | Blanket Tug | 3.8s | 身侧小毛毯 | 困倦地把被子拉近身体 |
| `sleeping` | Top-down Sleep | 6.4s | 俯视床垫、枕头、同一条毛毯与像素 Zzz | 整只平躺盖被，闭眼和双爪露出 |
| `waking` | Morning Stretch | 2.6s | 身前小毛毯 | 起身伸展，被子滑落 |
| `thinking` | Puzzle Turn | 4.6s | 双爪间一块拼图 | 翻转最后一块，停住思考 |
| `working` | Tile Stack | 3.4s | 身前两块重叠工作牌 | 双爪交替整理并检查 |
| `delegating` | Parcel Stack | 5.0s | 一件包裹、身侧纵向两位助手 | 把包裹逐级交给助手 |
| `needs_owner` | Stuck Jar | 4.8s | 身侧一个玻璃罐 | 拧不开，推给主人 |
| `compacting` | Suitcase Fold | 4.8s | 身前小行李箱与纵向条纹布 | 把长内容向下折进行李箱 |
| `workspace` | Workspace Folder | 4.2s | 身侧竖直文件夹 | 弹开并进入新的工作位置 |
| `success` | Self High-five | 2.9s | 无道具 | 起跳并在头顶击掌 |
| `error` | Basket Rescue | 4.8s | 一个大编织篮 | 被扣住、挣脱、又被碰倒 |

## 状态链与退出规则

- `away → sleeping → waking → idle` 共享紫色毛毯；完整床铺只在真正的 `sleeping` 中出现，保留俯视平躺与明确的 `Zzz`。
- `thinking → working` 共用双爪在身体前操作小物件的语言，不使用地面工作区。
- `working → needs_owner` 先停止 Tile Stack，再切到身侧大罐子的求助动作。
- `workspace` 与 `success` 为单次动作，结束后分别进入 `working` 与 `idle`。
- `error` 与 `needs_owner` 只由外部事件解除，不能自行宣告成功。
- 状态切换最多允许 `120ms` 透明度交叉淡入，不使用模糊或拖影。

## 文件兼容说明

V5.3 保留既有 SVG 文件名，避免后续运行时引用失效；文件内部标题、动作与合同均已替换。例如 `shell-shuffle.svg` 现在实现 **Puzzle Turn**，`token-knitting.svg` 现在实现 **Tile Stack**。旧视觉可在 Git 历史中查看，不在当前动作实验室展示。

机器可读合同见 [`main-state-actions.json`](main-state-actions.json)，生产源文件见 [`../src/animations/`](../src/animations/)。
