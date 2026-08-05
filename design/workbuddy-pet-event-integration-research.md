# WorkBuddy 宠物状态集成调研

## 结论

WorkBuddy 5.3.8 的实时工作状态可通过其 Claude Code 兼容 Hooks 接入 Maclawd。已有开源项目 Clawd on Desk 实现了这条路径，因此技术可行性高；建议独立实现，不能直接复制其 AGPL-3.0 代码。

## 现有参考

- [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)：直接支持 WorkBuddy，向 `~/.workbuddy-ai/settings.json` 或旧版 `~/.workbuddy/settings.json` 合并 Hooks，并只传递状态和通知，不接管权限。
- [WorkBuddy installer](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/hooks/workbuddy-install.js)：可参考配置目录选择、非覆盖合并、原子写入和卸载边界。
- [WorkBuddy hook adapter](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/hooks/workbuddy-hook.js)：验证了 SessionStart、SessionEnd、UserPromptSubmit、PreToolUse、PostToolUse、Stop、Notification、PreCompact 等事件映射。
- [Ping Island](https://github.com/erha19/ping-island)：包含 WorkBuddy/CodeBuddy 相关编辑器焦点支持，可作为窗口与会话检测的补充参考，但不如 Hooks 直接。
- [CodeBuddy Hooks Reference](https://www.codebuddy.ai/docs/cli/hooks)：给出兼容 Hook 的配置结构、事件、输入 JSON 和执行语义。

## 对 Maclawd 的实现建议

1. 在设置页提供明确的“启用 WorkBuddy 事件增强”开关，用户主动开启后才修改 WorkBuddy 配置。
2. 探测当前版 `~/.workbuddy-ai/settings.json` 与旧版 `~/.workbuddy/settings.json`，保留已有字段和 Hooks；使用带标识的条目、备份及原子写入，卸载时只删除 Maclawd 自己的配置。
3. Hook 从 stdin 读取事件 JSON，快速向 Maclawd 本地事件接口上报 `agentId: workbuddy`、session、cwd、event 与 tool_name，并始终正常退出，不能阻塞 WorkBuddy。
4. 第一阶段仅接入已经被现有实现验证的 8 类事件；状态可映射为启动/思考/工作/提醒/压缩上下文/结束。工具事件再映射到读文件、写代码、执行命令等更细动作。
5. WorkBuddy 继续负责所有权限交互；Maclawd 只显示状态和通知，不注册或处理 PermissionRequest 决策。
6. 扩展 Maclawd 的状态来源注册与状态引擎，使其接受 `workbuddy`，并加入超时回落，防止缺失结束事件时宠物长期停留在工作状态。

## 风险与边界

- 基础生命周期和工具活动的可行性高；精确区分成功、失败、子代理和权限等待，需要针对 WorkBuddy 5.3.8 实测实际事件与 payload。
- WorkBuddy/CodeBuddy 可能在会话启动时快照 Hooks 配置，因此启用后通常需要新开会话或重启相关任务。
- Hooks 解决工作状态，不提供月度积分；积分仍应通过已有的本地数据读取方案单独实现。
- Clawd on Desk 为 AGPL-3.0，而 Maclawd 当前为专有许可证。可以研究公开行为、测试思路和官方协议，但不应复制其实现代码。

## 判断

推荐实现。首版范围应限定为“状态与通知增强”，预计基础兼容成功率约 80%–90%；在一台 WorkBuddy 5.3.8 环境完成事件矩阵测试后，再扩展更精细的动作和失败状态。
