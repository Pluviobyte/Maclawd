# Maclawd 工作活动修饰 v1

这 6 个动作是 `working` 的可选修饰，不是新的主状态。运行时只有在外部
事件提供可靠类别时才覆盖 **Token Knitting**；仅知道 Agent “正在忙”时必须
回退到 generic `working`，不能猜测它具体在读、写、测试或同步。

| 修饰状态 | 动作 | 外部信号示例 | 视觉故事 |
| --- | --- | --- | --- |
| `working.reading` | Card Browsing | 读文件、打开网页、读取搜索结果 | 从左到右读三张相连卡片，再检查整叠 |
| `working.writing` | Note Stitching | 写文件、应用补丁、编辑文档 | 把三段彩色记录缝入小纸条后举起检查 |
| `working.command` | Wind-up Command | 命令启动、终端执行 | 拧紧玩具发条，松手并观察它执行 |
| `working.building` | Block Tower | 构建、编译、打包启动 | 把三块积木搭成塔并扶稳顶层 |
| `working.testing` | Wobble Test | 测试、质检、验证启动 | 逐个轻敲三只摇摆玩具并等待它们稳定 |
| `working.syncing` | Relay Bead | fetch、pull、push、远端同步 | 珠子沿绳从左爪传到右爪并完成交接 |

共同限制：不显示文字、终端、文件图标、进度条或具体内容；所有道具只在
修饰动作期间出现；信号结束后回到当前主状态，而不是自动切到 `success`。

机器可读映射见 [`activity-modifiers.json`](activity-modifiers.json)。

