# Maclawd 工作活动修饰 v2

这 5 个动作是 `working` 的可选修饰。只有外部事件提供可靠类别时才覆盖 **Busy Claws**；仅知道 Agent “正在忙”时必须回退到 generic `working`。

| 修饰状态 | V4 动作 | 外部信号示例 | 放大后的熟悉轮廓 |
| --- | --- | --- | --- |
| `working.reading` | Open Book | 读文件、打开网页、读取搜索结果 | 一本身体宽度的 V 形打开书 |
| `working.writing` | Big Pencil | 写文件、应用补丁、编辑文档 | 一支身体长度的斜铅笔 + 一张纸 |
| `working.building` | Two-block Build | 构建、编译、打包启动 | 两块大积木叠成塔 |
| `working.testing` | Roly-poly Test | 测试、质检、验证启动 | 一个会摇回正中的大不倒翁 |
| `working.syncing` | Chest Relay | fetch、pull、push、远端同步 | 一颗沿胸前绳索移动的大珠子 |

`working.command` 不再有独立动作。终端执行只能可靠说明“正在工作”，不能说明具体动作内容，因此它在映射层别名到 `working`，视觉上播放 **Busy Claws**。旧的 `wind-up-command.svg` 仅作为历史兼容入口，其专属发条配件已经隐藏。

共同限制：不显示文字、终端、文件图标、进度条或具体内容；主要道具接近身体尺寸；信号结束后回到当前主状态，而不是自动切到 `success`。

机器可读映射见 [`activity-modifiers.json`](activity-modifiers.json)。
