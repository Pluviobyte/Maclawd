# Maclawd 工作活动修饰 v5.3

这 5 个动作是 `working` 的可选修饰。只有外部事件提供可靠类别时才覆盖 **Tile Stack**；仅知道 Agent “正在忙”时必须回退到 generic `working`。

| 修饰状态 | V5 动作 | 外部信号示例 | 完整小场景 |
| --- | --- | --- | --- |
| `working.reading` | Pocket Book | 读文件、打开网页、读取搜索结果 | 抱着一本贴身大书翻页 |
| `working.writing` | Letter Note | 写文件、应用补丁、编辑文档 | 握住信纸，用竖直长铅笔书写 |
| `working.building` | Block Stack | 构建、编译、打包启动 | 在身侧纵向叠两块积木 |
| `working.testing` | Toy Check | 测试、质检、验证启动 | 轻推身侧不倒翁并观察回正 |
| `working.syncing` | Spool Sync | fetch、pull、push、远端同步 | 双爪间把线轴沿竖绳拉起 |

`working.command` 不再有独立动作。终端执行只能可靠说明“正在工作”，不能说明具体动作内容，因此它在映射层别名到 `working`，视觉上播放 **Tile Stack**。旧的 `wind-up-command.svg` 仅作为历史兼容入口，其专属发条配件已经隐藏。

共同限制：不显示文字、终端、文件图标、进度条或具体内容；主要道具接近身体尺寸；信号结束后回到当前主状态，而不是自动切到 `success`。

机器可读映射见 [`activity-modifiers.json`](activity-modifiers.json)。
