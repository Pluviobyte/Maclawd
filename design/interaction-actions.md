# Maclawd 互动与环境动作 v5

互动动作由 Mac 桌面输入或系统环境触发，不表示 Agent 的具体任务进度。
短反应播放完成后恢复触发前的主状态；拖拽动作在按住期间持续，松手后切到
落地动作；环境循环只在条件持续时播放。

| 触发 | 动作 | 模式 | 恢复规则 |
| --- | --- | --- | --- |
| 单击 | Cushion Poke | 2.2s 短反应 | 回到触发前主状态 |
| 双击/连点 | Cushion Hop | 2.4s 短反应 | 回到触发前主状态 |
| 开始拖拽 | Hanging Cling | 按住循环 | 松手进入 `Cushion Bounce` |
| 结束拖拽 | Cushion Bounce | 2.6s 短反应 | 回到触发前主状态 |
| 屏幕边缘空闲彩蛋 | Curtain Peek | 条件循环 | 离开边缘或收到主事件即退出 |
| 系统低电量 | Cushion Curl | 条件循环 | 电量恢复或接通电源即退出 |

点击、拖拽与低电量都不需要 Agent 内部 Hook；它们可以由 macOS 应用自身
获取。`Curtain Peek` 是产品行为，不应由模型事件误触发。V5 用一整片帘幕取代
抽象屏幕边线；低电量让 Clawd 蜷进同一套软垫语言，仍不使用电池图标或进度条。

机器可读映射见 [`interaction-actions.json`](interaction-actions.json)。
