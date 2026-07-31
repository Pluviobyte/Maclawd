# Maclawd macOS 外壳

状态：**已可构建运行并实机验证**（Swift 6 + SwiftPM，980KB `.app`）。
未签名未公证，尚不可分发。

```bash
cd mac && ./package.sh && open Maclawd.app
# 或开发时直接
cd mac && swift run
```

## 职责边界：外壳只做渲染与系统集成

状态机、采集、去重、聚合、计价**全部留在 Node 运行时里**，外壳通过 `127.0.0.1`
消费同一个引擎。

这不是偷懒。在 Swift 里把状态机重写一遍就有了两份实现，两份实现必然漂移，
而漂移的表现是「桌宠的动作和面板的数字对不上」——那种 bug 极难定位。
所以外壳启动时把 `bin/maclawd-usage.js serve` 作为子进程带起来，
用户不需要自己开终端。

```
Maclawd.app
├─ MacOS/Maclawd            Swift 外壳（渲染 + 系统集成）
└─ Resources/runtime/       随包携带的 Node 运行时
   ├─ bin/ src/ web/ design/
   └─ package.json
```

## 关键决策

**用 WKWebView 渲染桌宠，不转图片序列。**
38 个动作是 CSS 驱动的 SVG 动画，WebKit 原生就能播——零资产转换、零重新导出，
动作契约改了桌宠立刻跟着变。换成 `NSImage` 会丢掉全部动画。
渲染时把 SVG 文本内联进一个透明背景的 HTML 里，既保证 CSS 动画一定执行，
也绕开本地文件访问权限。

**减弱动效通过注入 `animation:none` 实现**，不改契约锁定的 `durationMs`。

**GUI 进程不继承 shell 的 PATH**，所以 `node` 要显式探测
（`/opt/homebrew/bin` → `/usr/local/bin` → `/usr/bin`，最后借一次 login shell 问）。
这和数据层为什么要扫 `~/.claude-*` 多 profile 是同一个原因。

**不启用 App Sandbox。** 要读 `~/.claude` 等目录，一旦沙盒化就必须让用户走文件
选择授权，「默认开启」立刻不成立（见 `token-tracking.md`「连带约束」）。
因此分发形态是 Developer ID + DMG，不上 App Store。

## 已实现

| | |
| --- | --- |
| 桌宠窗口 | 无边框、透明、`.floating` 层级、全空间可见、不占 Dock 图标（`LSUIElement`） |
| 交互 | 拖拽移动、松手贴边收拢、单击纯玩耍不开面板、双击开用量统计 |
| 菜单栏 | `NSStatusItem` + 4 档显示密度（仅标记 / 今日 tokens / 今日成本 / 实时速率） |
| 菜单 | 当前状态、今日数字、显示隐藏桌宠、打开两个面板、登录项开关、退出 |
| 登录项 | `SMAppService`（macOS 13+）；更早系统明确不支持而不是假装成功 |
| 运行时 | 自动拉起与退出时清理子进程 |

**单击不开面板是刻意的**——桌宠首先是宠物，不是按钮。双击既复用了已有的
`interaction.double_click`（Surprised Hop）语义，又给了发现路径。

## 实机验证记录

在 macOS 26.3.1 / arm64 / Swift 6.2.4 上：

- `swift build -c release` 通过，`package.sh` 产出 980KB `.app`
- 启动后 Node 运行时子进程自动从 bundle 内拉起，`127.0.0.1:4173` 正常响应
- 截图确认桌宠透明浮窗渲染正确：`#DE886D` 躯干、双爪、四腿、双眼，几何符合角色合同
- 状态引擎实时生效：实时 tailer 抓到 231 万 tokens/min 的真实活动，
  桌宠从 Quiet Watch 切到 **Tile Stack** 并带上两块工作牌（`#7BC8C4` / `#B9A1D9`），
  同时 energy 降到 0.40（今日吞吐达个人基线的 60%）
- 辅助功能枚举确认 `NSStatusItem` 已注册（`menu bar 1` → `status menu`）；
  开发机菜单栏被占满，图标被 macOS 折叠到 `‹` 之后，属正常溢出行为
- 退出时子进程一并清理，无残留

## 外壳事件回灌（已实现）

外壳把自己的输入与系统事件 POST 回 `/api/event`，状态引擎据此驱动动作。
**这条回路缺了很久**：外壳里早有拖拽和点击的代码，但事件从没送出去，
于是 13 个画好的动作一次都没在屏幕上出现过。

| 外壳事件 | 动作 |
| --- | --- |
| `shell.click` / `doubleClick` | Poke Squish / Surprised Hop |
| `shell.dragStart` / `drop` | Hanging Loop / Drop Wobble |
| `shell.hover` | Cursor Gaze |
| `shell.screenEdge` | Curtain Peek |
| `shell.lowBattery` / `powerConnected` | Low Battery Droop / **Morning Stretch** |
| `shell.offline` / `reconnected` | Signal Listen / Ready Wiggle |
| `shell.paused` | Statue Pause |

电量用 `IOPSCopyPowerSourcesInfo` 轮询，网络用 `NWPathMonitor`；
两者都**只在跨越阈值时报一次**，否则每 2 秒会刷一遍同一个状态。

`powerConnected` 落到 Morning Stretch 是契约里的 `mapsTo` 别名——
「能量回来了」本身就读得懂，不需要再加充电器道具。
早先编排器忽略了 `mapsTo`，且服务端按「必须有 name」过滤动作条目，
把只有 `id + mapsTo` 的别名整条滤掉，导致别名一直没生效。两处都已修。

## 图标与分发（已实现）

图标**按角色几何合同程序化绘制**（`make-icon.swift`），不是手画的一张图——
这样图标与桌宠本体必然同源，契约改了重跑一次即可，不会漂移。

```bash
./package.sh                      # ad-hoc 签名，本机自测
MACLAWD_DMG=1 ./package.sh        # 额外产出 Maclawd.dmg（676K）
MACLAWD_SIGN_ID="Developer ID Application: …" MACLAWD_DMG=1 ./package.sh
```

设了 `MACLAWD_SIGN_ID` 就走 Developer ID + 硬化运行时 + 时间戳，
并打印公证三步命令。**公证需要你的 Apple 开发者账号，这一步我做不了。**

## 仍然缺的

1. **Developer ID 签名与公证。** 脚本已就绪（`MACLAWD_SIGN_ID`），
   但需要 Apple 开发者账号（$99/年）。当前 ad-hoc 签名只能本机跑，
   别人下载会被 Gatekeeper 拦。
2. **22px 菜单栏标记的正式设计。**
   现在是按角色几何合同**程序化重绘**的功能占位：躯干 + 双爪 + 四腿 + 双眼，
   睡眠时闭眼（横线代替竖眼），加一个状态色点（idle 不点亮——常态不该有指示灯在闪）。
   5 档状态收敛逻辑已实现，但真正好看、22px 可读的标记仍需设计定稿，
   见 `token-experience.md` 待决事项 1。
3. **产品身份**：名称、配色之外的品牌资产（图标已有）。
