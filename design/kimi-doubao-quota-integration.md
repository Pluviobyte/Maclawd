# Kimi 与豆包工作账户额度接入

实现日期：2026-09-10。研究依据见 [上游版本、近期修复和问题记录](kimi-doubao-upstream-research-2026-09-10.md)、[本机资源与存储核查](kimi-doubao-local-feasibility-2026-09-10.md)。本记录描述实现阶段，更新前述调研中“后台查询尚未验证”的结论。

## 已验证的数据路径

- **Kimi 桌面**：读取 `kimi-desktop/bridge-store/token-store.json` 的 `safeStorage.v1` 容器，利用其已有 macOS Safe Storage 密钥在内存中解密；校验原始 origin 后，向对应官方会员 `GetSubscriptionStats` 发送只读请求。本机返回 HTTP 200，总使用量 0%，结束时间 `2026-09-12T07:23:36.982463Z`，与官方页面一致。没有把免费套餐总池固定标成“月度”。
- **豆包工作**：读取专属 DoubaoWork profile 的 `sessionid`、`passport_csrf_token`，按 Cookie 数据库版本验证 SHA256(host_key) 后解密。独立实现向 `/alice/commerce/sale/subscription/quota/summary/` 发送 `{product_line:"membership"}`，HTTP 200 / code 0。5 小时窗口未启动，7 天已用 1%，结束时间 `1789570338794` 毫秒，与官方 UI 一致。
- **本机已证实无需 `a_bogus` / `msToken`**：上述额度端点的最小请求只携带 sessionid、CSRF、Origin/Referer 即成功。没有移植或绕过客户端签名算法。其他账号、地区或后续版本仍可能变化，错误按实际响应降级。
- **Kimi Code CLI**：独立来源，读取现代/旧根目录和官方生成的 managed provider 配置，按配置引用选择环境隔离凭据文件，校验地区，再请求 `/coding/v1/usages`。本机 CLI 旧 access token 仍返回 401；这不会影响已登录桌面 Kimi 的总池。没有用桌面账号替代另一个 CLI 账号，也没有制造模型调用来刷新额度。

官方本机 bundle 与本项目独立实现的 HTTP 查询，是豆包本次字段、单位和认证组合的两套实现验证；仍未发现第二个第三方开源适配。企业、月度、创作额度包、豁免等分支有官方客户端代码及合成契约测试，没有把它们声明为本机企业账号实测。

## 接入结构

- `desktop-quota-auth.js`：限定供应商和 profile 的凭据读取、macOS v10 解密、Cookie v24+ host 绑定。
- `quota-client.js`：有界 HTTP 读取、禁止重定向、超时和取消、固定错误分类，错误不带远端正文或认证信息。
- `kimi-quota.js`：桌面总额度 / Work / Code 窗口，以及独立 CLI 来源。百分比按已确认字段分别由 0..1 比例或 used/limit 转换。
- `doubao-work-quota.js`：个人/企业/创作包独立窗口，保留 5 小时尚未开始、临时不限额和 `<1%` 语义；不知道绝对用量单位时不标成 Token 或 Credits。
- `provider-quota-collector.js`：10 分钟刷新；成功和失败都节流；并发合并；停用/重启/关闭时丢弃旧请求；15 分钟之后标记旧数据。401/403 重读官方凭据一次，跟随官方应用已有刷新，**不自行旋转或覆盖 refresh token**。
- `/api/quota` 和原生面板接入三个来源 `kimi` / `kimi-code` / `doubao-work`，同时提供读数与错误状态，复用既有显示/排序偏好和统一额度开关。

## 登录与隐私边界

生产实现直接使用系统 `/usr/bin/security find-generic-password` 读取两个固定 service 的已有密码，输出只进入 Node 私有管道。子进程有 5 秒上限；未找到应用数据时不查钥匙串；子进程失败、stdout/stderr、HTTP 正文、解密数据不会进入状态接口或日志。解密密钥 Buffer 使用后清零，JS 字符串生命周期由运行时管理；不承诺对 JS 字符串作物理内存擦除。

本机系统 security 工具已能读取这两个条目，正式代码也已成功查询；**不能据此保证每台 Mac 首次访问都不出现系统授权提示**。macOS 是否提示由该机钥匙串 ACL 和锁定状态决定。没有自动修改 ACL、解锁钥匙串、创建密钥或接受授权弹窗。另行试验过的自编译非交互 helper 在本机被拒绝，未将其打入产品，也未实现从该 helper 失败自动回退的链路。严格保证“永不弹窗”的部署需求需要单独设计授权入口，不能以 ACL 预检宣称保证。

跨区域只使用凭据所属官方地址；不遇错轮询另一地区。不查询 Moonshot Open Platform 余额或火山方舟余额，不把订阅百分比换算为本地 Token 或费用。

## 上游版本与选择

本轮实现前重新联网核对 HEAD，官方 `MoonshotAI/kimi-code@2da4aa23b0d484312cc068b2d4b2a62e694a2bfe`、`steipete/CodexBar@5c0d7b4f87d64dfde01043955cce73f78f6b5ecb` 与前序研究一致；默认分支与 release 差异见上游调研。加密参数另与 Chromium/Electron、SweetCookieKit `881be74146f1100e10e04d67f566793e08a700e3`、browser_cookie3 `03895797e48dd107806db171d8392c562151807d` 对照。仅按协议独立编写，无复制第三方实现。

## 验证

- 两个真实账号独立 HTTP 查询与官方页面对照；正式 reader 再查询成功，只输出已归一化额度。
- 定向 Node/Swift 测试 76 项通过：字段单位、免费套餐、窗口顺序、个人/企业/额度包、豁免、开始计时、现代/旧路径、环境隔离引用、地区绑定、凭据重读、加密/host 验证、错误脱敏、限流、取消、停用后丢弃、HTTP 集成、原生解码。
- 原生 `swift build --package-path mac -c debug` 成功。
- `npm test` 全量 669 项通过，0 失败、0 跳过。
- `CONFIG=debug ./mac/package.sh`（从 mac 目录执行 `./package.sh`）打包成功；这是本机 arm64 构建，不是通用分发包。
- 重启本机打包应用后，新运行时 `/api/quota` 中 Kimi、豆包工作均为 live，collector 均 `lastError=null`，开启已有统一额度开关即自动读取。
- 原生概览可访问性树实测显示 `Kimi 总额度 剩余 100%`、`豆包工作 5 小时 剩余 100% 开始使用后计时 7 天 剩余 99%`，显示工具数量由 4 增至 6。Kimi Code 单独显示登录已过期，没有覆盖桌面读数。
