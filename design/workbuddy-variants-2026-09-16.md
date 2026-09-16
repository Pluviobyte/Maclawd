# WorkBuddy 国内／海外版拆分

## 实际核对来源

2026-09-16 联网核对最新默认分支、稳定 release 与近期提交、相关 issue：

- robinebers/openusage main `56378e5765f85d38ff413036fd984afe3d4664e4`，稳定版 v0.7.11。当前无 WorkBuddy 专用实现；最新提交涉及 Codex Swap。
- vibe-cafe/vibe-usage main `fcf1c3981890cf31267b1ee1adf88d61a75fdbb5`，稳定版 v0.10.21，默认分支已更新至 0.10.31。核对最新 workbuddy-roots 模块与 WorkBuddy 模型归属相关 issue；默认根同时包含 .workbuddy-ai 与 .workbuddy，但上游归为同一来源。本次依据用户需求按目录分别归属。
- GA0LU/TokenBar main `62b9c991a5ec3f351d57bda618e38803fd4047e9`，稳定版 v1.1.0。核对最新 main.swift 的 WorkBuddy 身份选择和 get-user-resource 接口，以及实时状态通道相关 issue。上游优先国内桌面身份并回退其它文件，本次明确取消跨版本回退，避免错误账户归属。
- 本机供应商正式安装包：WorkBuddy 5.3.12、WorkBuddy AI 5.5.2。Info.plist、app.asar 中 dev-env-override 模块明确区分国内 .workbuddy 与海外 .workbuddy-ai；海外 loginRedirect 模块列出 www.workbuddy.ai 为正式海外域名，application-manifest 包含计费查询实现。Launch Services 实测两个 bundle identifier 均能定位应用。

选择最新默认分支作行为参考，版本拆分以供应商实际安装包为准，不复制上游代码。计费请求的身份字段、接口结构与 TokenBar 交叉核对，再用两版本真实响应脱敏验证。

## 隔离契约

| 项目 | 国内 | 海外 |
| --- | --- | --- |
| 来源 ID | workbuddy（保留原值） | workbuddy-ai |
| 应用 ID | com.workbuddy.workbuddy | com.workbuddy.workbuddy-ai |
| 数据目录 | ~/.workbuddy | ~/.workbuddy-ai |
| 认证文件 | workbuddy-desktop.info | workbuddy-desktop-ai.info |
| 测试日志覆盖变量 | MACLAWD_WORKBUDDY_DIR | MACLAWD_WORKBUDDY_AI_DIR |
| Hook 配置覆盖变量 | MACLAWD_WORKBUDDY_SETTINGS | MACLAWD_WORKBUDDY_AI_SETTINGS |

两版独立安装／修复／卸载 Hook，独立额度刷新状态，独立额外积分包展开状态。海外修复会替换旧版本误写的国内来源标记，并保留第三方 Hook。通用 WORKBUDDY_CONFIG_DIR 不再用于自动判定区域，避免两版落到同一配置文件。海外实时会话加来源前缀，避免与国内同名会话冲突。

解析缓存与聚合版本升级后重建旧的混合统计；不修改原始日志。Token 与费用统计仍来自本地调用日志，服务端积分额度保持独立口径。海外没有真实调用日志样本，故保持“待验证”标记。

凭据仅从当前版本的精确文件读取，登出标记生效，不借用另一版或 CodeBuddy 身份。请求只发往凭据绑定的已知供应商域名，禁止 HTTP 重定向；海外缺少域名时报告 EDOMAIN，不猜测国内域名。

## 验证

真实只读请求：国内 www.codebuddy.cn 成功返回 3 个积分桶；海外 www.workbuddy.ai 成功返回 1 个积分桶。未记录凭据、用户 ID 或账户原始响应。

自动测试覆盖版本目录与调用归属、同名会话、认证文件隔离／登出、域名拒绝、Hook 独立安装卸载与旧标记修复、海外事件上报、原生安装探针与额度解码。Swift release 编译通过。

全量 727 项测试通过；补充无会话目录识别后，54 项相关测试通过。新本地应用已完成打包、签名校验与运行时版本匹配验证。两个版本的额度后台采集均成功。

推送前独立验证：仅本次变更的提交快照通过 711 项全量测试与 Swift release 编译；其他未提交工作保留在本地。
