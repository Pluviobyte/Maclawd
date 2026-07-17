# Maclawd 工作活动修饰 v5

这 5 个动作是 `working` 的可选修饰。只有外部事件提供可靠类别时才覆盖 **Desk Shuffle**；仅知道 Agent “正在忙”时必须回退到 generic `working`。

| 修饰状态 | V5 动作 | 外部信号示例 | 完整小场景 |
| --- | --- | --- | --- |
| `working.reading` | Floor Book | 读文件、打开网页、读取搜索结果 | 坐在圆地毯上翻一本大书 |
| `working.writing` | Letter Desk | 写文件、应用补丁、编辑文档 | 伏在低木桌前用大铅笔写信 |
| `working.building` | Block Garden | 构建、编译、打包启动 | 在游戏地毯上叠两块大积木 |
| `working.testing` | Toy Check | 测试、质检、验证启动 | 跪在软垫旁观察不倒翁回正 |
| `working.syncing` | Clothesline Relay | fetch、pull、push、远端同步 | 把条纹小袋沿短晾衣绳送过去 |

`working.command` 不再有独立动作。终端执行只能可靠说明“正在工作”，不能说明具体动作内容，因此它在映射层别名到 `working`，视觉上播放 **Desk Shuffle**。旧的 `wind-up-command.svg` 仅作为历史兼容入口，其专属发条配件已经隐藏。

共同限制：不显示文字、终端、文件图标、进度条或具体内容；主要道具接近身体尺寸；信号结束后回到当前主状态，而不是自动切到 `success`。

机器可读映射见 [`activity-modifiers.json`](activity-modifiers.json)。
