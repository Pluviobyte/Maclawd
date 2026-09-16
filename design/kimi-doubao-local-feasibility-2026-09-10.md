# Kimi 与豆包工作：本机接入可行性核查

> 这是接入前的研究快照。后续已完成后台 HTTP 验证和本机产品接入，当前行为与测试结果见 [接入记录](kimi-doubao-quota-integration.md)。

核查日期：2026-09-10（Asia/Shanghai）。本次是研究，不是完成产品接入。先搜索开源参考，再只读核查已安装应用、数据结构和官方界面；未修改应用登录文件或 Maclawd 产品代码。

上游最新默认分支、release、issue、固定 commit 和许可记录见 [开源调研](kimi-doubao-upstream-research-2026-09-10.md)。本文补充本机实证及其限制。

## 结论

| 对象 | 已证实 | 当前判断 |
| --- | --- | --- |
| Kimi Code 本地 Token | Maclawd 已有解析器；本机 46 个 wire.jsonl、1,582 条 usage.record 全部可解析 | 已支持，不需要从零新增 |
| Kimi Code 账户额度 | 官方 usages 接口、多个独立适配、本机 CLI 凭据路径存在 | 可实现；本机旧 access token 查询 401，需官方刷新流程或恢复登录后复验 |
| Kimi 桌面会员总额度 | 官方会员服务已有第三方适配；本机 3.2.5 初始化后恢复登录，官方页面显示总使用量 | 可实现；UI 验证成功，独立 HTTP 响应尚未验证；不能用 Code 周额度代替 |
| 豆包工作账户额度 | 官方本机前端明确给出查询接口、字段及个人/企业分支；官方页面成功显示真实额度 | 有明确可行路径；尚未证明无界面后台读取稳定性，先做最小验证原型 |
| 豆包工作本地 Token/费用 | 有 Chromium 存储和运行日志，限定扫描未找到可靠 Token 计数 | 未证实，不应以订阅百分比反推 Token 或费用 |

## 1. 本机安装与 Maclawd 现状

- `/Applications/DoubaoWork.app`：2.28.12，bundle ID `com.work.pc.doubao`。这是用户所说的豆包工作，不能与同时安装的普通 Doubao 或火山方舟混淆。
- `/Applications/Kimi.app`：3.2.5，bundle ID `com.moonshot.kimichat`。
- 本机 `kimi` 命令位于 `~/.kimi-code/bin/kimi`；`kimi --help` 的新 CLI 提供 login/provider/acp/web 等命令，没有独立的 usage 子命令。不要直接假设旧 Python CLI 的命令行接口仍适用。
- Maclawd 的 `src/runtime/parsers/kimi-code.js` 已读取现代 `~/.kimi-code/sessions` 和旧 `~/.kimi/sessions`，支持 `KIMI_CODE_HOME` 等根目录覆盖，注册在 `src/runtime/parsers/index.js`。
- `src/runtime/account-quota.js`、`src/runtime/server.js` 尚无 Kimi 或豆包工作的账户额度 collector。Token 统计和账户额度是两个不同接入层。

## 2. Kimi 的本机验证

### Token 日志

只读遍历 `~/.kimi-code/sessions/**/wire.jsonl`，不输出对话或提示词。发现：

- 46 个文件，1,582 条 `usage.record`。
- `usageScope=turn` 1,581 条，`session` 1 条。
- 字段为 `usage.inputOther`、`output`、`inputCacheRead`、`inputCacheCreation`，时间是毫秒 `time`。
- 用现有 Maclawd `parseObject()` 逐条验证，1,582 条均接受，包含上述 session 范围事件。

官方最新 kimi-code 源码说明 scope 表示事件归属，不意味着该条是累计汇总。必须结合上游调研里的官方证据；不能照抄某些第三方“忽略 session scope”的逻辑。现有 Maclawd 只读取 `usage.record`、忽略重复携带用量的循环事件，方向正确。本次并未对任意历史版本的迁移副本、跨文件去重或所有平台作完整审计。

这证明的是 Kimi Code 日志覆盖，不能据此声称 Kimi Chat/Work 桌面的所有消费都在这些文件中。

### 账户认证与查询

- `~/.kimi-code/credentials/kimi-code.json` 存在，含 `access_token`、`refresh_token`、`expires_at` 等字段；只检查结构和过期状态，未输出字段值。
- 只向对应供应商 `https://api.kimi.com/coding/v1/usages` 发起一次只读 GET；本机 access token 已过期，返回 HTTP 401，响应正文未输出。
- 未调用 refresh grant，未旋转或覆盖凭据。因此不能把 401 解释为“接口不可用”或“用户必须重新登录”；refresh token 是否可恢复，本次没有验证。
- 桌面存储目录为 `~/Library/Application Support/kimi-desktop`。`bridge-store/token-store.json` 为 `{encryption,data}` 容器，本机打包主进程存在 Electron `safeStorage` 使用；未尝试解密。
- 初次检查桌面 `Cookies` 数据库没有 `kimi-auth`，界面初始化时暂时显示“登录”；等待初始化完成后应用自动恢复已有账号。**初始登录按钮不是最终状态，不能据此判断用户未登录。**第三方从 Cookies 读 kimi-auth 的路径不能保证覆盖初始化状态，更不能假设该版本始终只用 Cookie 登录。
- 在已登录的官方桌面内打开“会员计划 → 额度和发票 → 使用额度”，页面 `kimi.com/settings/subscription?tab=quota` 显示 **Free、总使用量 0%、Kimi、2026-09-12 后重置**。这个账号本次没有展示 Code 的 5 小时/7 天窗口，不应补造这些字段。
- 打开会员页后再次只读查询同一 Cookies 数据库，`kimi-auth` 仍无记录。这构成了实际反例：当前官方应用已登录且能显示会员额度，但 CodexBar 的桌面 Cookie 发现路径在此机不够用。应继续验证官方进程认证桥接或 safeStorage 对应的合法读取路径，不能直接宣称复制 Cookie 读取就能零配置成功。
- 该免费套餐快照也说明总池周期不可无条件标成“月度”；应按服务端/官方 UI 提供的到期时间呈现。已验证的是官方页面数值，尚未验证脱离页面的 HTTP JSON。

下一步额度 collector 应优先跟随官方新 CLI 的刷新互斥、原子写入和凭据重读规则，区分 CLI 未登录、可刷新过期、刷新失效、网络错误和无订阅。桌面总额度需独立验证可用认证入口，不能因 CLI 401 就隐藏桌面仍可读取的额度。

## 3. 豆包工作：从官方本机代码定位到真实界面

### 精确的数据源

官方打包资源根：

```text
/Applications/DoubaoWork.app/Contents/Helpers/DoubaoWork Browser.app/Contents/Frameworks/DoubaoWork Browser Framework.framework/Versions/147.0.7727.149/Resources/local_webcontents/biz/ahalets/doubao/contents/doubao/static/js/
```

核查的关键资源（只分析机制，未复制厂商实现到项目）：

| 文件 | SHA-256 |
| --- | --- |
| `async/s0-init-membership-quota-summary.c8b2b417.js` | `17d4206fa152cb4f782d55428b4c731c3a5435331fa6d48611a9282f25663793` |
| `async/s2-context-window-membership-quota-service.c6bad450.js` | `960bb80a73eaceb99dbbb25154d7730bc6d48c81e02970fbf1cad59fd514961d` |

生成的客户端方法 `AGWGetSubscriptionQuotaSummary` 也可在 `async/s2-office-sdk-pc-runtime.72ad2618.js` 与 `async/s2-applet-runtime.2edfad72.js` 追踪。多个 bundle 是同一厂商产物，**不算两个独立开源实现**。

客户端调用：

```http
POST https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/
Content-Type: application/json

{"product_line":"membership"}
```

代码检查业务 `code`，成功后读取 `data`，登录前不发送查询。客户端在打开/激活和相应额度重置时刷新，失败会标记失败并保留已有展示数据。

| 字段 | 官方本机代码显示的含义 |
| --- | --- |
| `window_limit_section` | 个人订阅窗口 |
| `enterprise_window_limit_section` | 企业订阅窗口 |
| `quota_package_section` | 创作额度包 |
| `window_limit_groups[].window_limits[]` | 各功能组的额度窗口 |
| `window_type` | 1=5 小时，2=7 天，3=订阅总包，4=月度 |
| `used_percent` | 0–100 已用百分比；客户端可解析数字字符串 |
| `less_than_one_percent` | 显示 `<1%`，不等同于精确 0% |
| `used_amount` / `total_amount` | 可选绝对用量字符串；单位不能自行假定为 Token、人民币或美元 |
| `end_time` | 5 小时重置显示直接与 `Date.now()` 相减，说明该分支是毫秒 |
| `exemption.active/end_time` | 5 小时临时豁免，显示暂无限制，不能装成真实消耗 0% |
| `member_info` | 含个人/企业订阅有效性，影响选择哪个额度区 |
| `enterprise_package_entitlement_groups` | 企业多个权益包的细分信息，不能任意混加 |

官方这个上下文小窗组件只给 5 小时行设置 `refreshAt`；本次尚未完整核对会员详情页的 7 天/月度重置字段。不要把所有窗口都固定成 `now + 7d`，也不要将小窗未显示周重置误解成服务端没有重置时间。

### 真实界面核对

通过官方应用的“头像 → 额度状态”打开 `doubao.com/member/quota-management?...&is_work=1`，可访问性树直接可读：

- 个人标准套餐（赠送时长）。
- 当前时段：未消耗，开始使用后计时。
- 近 7 天：已用 1%。
- 页面显示 `9月16日 22:52 重置`。

以上是当时的界面快照，不应硬编码到测试或视为持续有效。本次没有消费模型、购买套餐或使用重置卡。

### 自动后台接入尚缺什么

- `~/Library/Application Support/DoubaoWork/Default/Cookies` 有 doubao.com 登录 Cookie，值为加密形式；本次只查询名称与字节长度。
- 本机当日日志证实客户端实际调用了上述 quota summary 地址；查询参数名称包括 `a_bogus`、`msToken` 和设备/平台信息。没有输出这些参数值，也没有把整条带签名 URL 写入研究记录。
- 存在签名参数并不证明每个参数对 quota endpoint 都强制必要；当前尚未做最小请求参数实验，不能承诺“只拿 sessionid 就能请求”。
- 优先验证通过官方已登录进程提供的合法请求能力复用认证；如果没有稳定接口，再评估有界的本地凭据读取。不能将长期 UI 自动点击或绕过签名作为正式后台方案。
- UI 的可访问性读取可用于验证数字含义，不能据此宣称有可发布的后台接口适配。
- 公开搜索目前未定位到豆包工作这个 endpoint 的两个独立开源适配，未达到 AGENTS.md 对未公开接口独立交叉验证的要求。官方本机代码 + 日志 + UI 是三类证据，仍不等同于两套独立实现。

### 本地日志能否直接给 Token

限定检查 `Default/IndexedDB`、`Default/Local Storage`、`Default/saman_shell_db_storage` 和当日运行日志，搜索 Token 与额度字段特征，没有发现可直接用来记账的 `usage.record` 或 input/output Token 记录。Chromium 的存储 quota、QuotaManager 等是磁盘空间额度，与 AI 订阅用量无关。

这是有界负面结果，不是宣称所有存储、压缩资源或历史版本都不存在 Token 数据。现阶段豆包工作应从账户额度原型入手。

## 4. Maclawd 实现顺序

1. **Kimi 账户额度**：沿现有 collector 模式新增；Kimi Code 窗口与桌面会员总池独立存储，不能相互推算。补官方刷新、现代/旧路径、套餐缺失、错误分类测试。
2. **Kimi UI**：复用现有本地 Token 来源；按实际响应支持 5 小时、周/月、总池与额外消费，窗口来源明确。未知费用保持未知，不能拿 API 余额当会员额度。
3. **豆包工作只读原型**：先证明稳定复用已登录状态、成功拿到脱敏 JSON，再核对个人与企业、试用赠送、额度包、豁免、`<1%` 和各窗口重置字段。
4. **豆包工作正式 collector**：原型通过后，扩展额度契约以表达不限额、窗口未启动、多权益包和未知重置。先补解析和 UI 顺序测试，再接刷新调度，失败不显示伪造 0%。

本次只增加研究文档；没有将未经验证的私有接口接入运行中的 Maclawd，也没有改动已有未提交的 Cursor 工作。


## 5. 实现补充：桌面认证容器与静默 Keychain 读取

本节仅研究官方应用代码及公开上游，不读取用户 token-store/Cookie 内容，不执行 Keychain 请求。

### 固定上游证据

- Electron `main@7d9a629ab84ad83ec4761be5b9fbc7d16de5c37c`，最新稳定 `v44.3.0`。核对 `shell/browser/api/electron_api_safe_storage.cc`、`shell/browser/electron_browser_main_parts.cc`、`patches/chromium/revert_oscrypt_remove_sync_backend.patch`。主分支和稳定版 safeStorage 文件有对象生命周期等差异，本次所需的同步 OSCrypt 格式未见语义变化；以官方本机调用的同步 `encryptString/decryptString` 为适配目标，不切换到异步格式。
- Chromium `main@5403439e4c2c2216f4636559e8c71e008f73b774`，核对 `components/os_crypt/common/keychain_password_mac.mm` 和 `net/extras/sqlite/sqlite_persistent_cookie_store.cc`。GitHub 仓库无 latest release；不能把不存在的 release 当作稳定证据。最新源码已经迁移/删除旧 `sync/os_crypt_mac.mm` 路径，Electron 补丁保留其同步后端。
- SweetCookieKit `main@881be74146f1100e10e04d67f566793e08a700e3`，最新稳定 `v0.5.2`。`Sources/SweetCookieKit/ChromeCookieImporter.swift` 在该 tag 与所核对 head 完全一致；同时核对 `BrowserCookieKeychainAccessGate.swift`。MIT，作为算法与行为证据，不复制代码。
- browser_cookie3 `master@03895797e48dd107806db171d8392c562151807d`，最新稳定 `0.19.1`。`browser_cookie3/__init__.py` 的稳定版缺少 head 所有的新版 Cookie 数据库 hash 处理，因此不采用稳定版对现代 Cookie 的行为。其当前实现独立确认 PBKDF2/AES 参数及数据库版本 24 前缀；hash 完整校验以 Chromium 与 SweetCookieKit 为准。
- 在线核对各仓库 latest release/open issues；browser_cookie3 近期问题包含 Firefox WAL/SHM 复制，说明活跃数据库读取不能仅复制主文件后假设数据完整。此处只提取通用一致性启示，不把 Firefox 问题当成豆包已复现故障。

### 加密数据契约

macOS v10 解密的参数为：取 Keychain 密码的原始字节，PBKDF2-HMAC-SHA1，salt=`saltysalt`，迭代 1003，导出 16 字节；移除明文 `v10` 三字节前缀后执行 AES-128-CBC，IV 为 16 个 `0x20`，严格验证 PKCS7 padding。不要 base64 解码 Safe Storage 密码本身。v11 是 Linux 分支，不能在 macOS 用 v10 参数“试解”；未知版本返回 unsupported。

Cookie `meta` 表的 `version >= 24` 时，解密后的前 32 字节必须等于 `SHA256(host_key 的原始 UTF-8)`，其中前导点不可删除。校验成功后才剥除 hash 并进行 UTF-8 解码；版本低于 24 不剥除。Kimi 的 safeStorage 字符串容器不是 Cookie，不能应用此 host hash 规则。

Electron 官方用 `Browser::Get()->GetName()` 设置 service=`app_name + " Safe Storage"`，account=`app_name`。因此不能从 `kimi-desktop` 数据目录名推断 service，必须核对应用实际名称/已有元数据。Chromium 默认 service/account 是 `Chromium Safe Storage` / `Chromium`，厂商可以覆盖；不能仅凭 DoubaoWork 是 Chromium 衍生品就断言其条目名称。主任务应依据本机厂商非敏感二进制/元数据确定精确服务名，再进行限定查询。

### Kimi 3.2.5 官方读取逻辑

仅分析 `/tmp/maclawd-kimi-doubao-research/kimi/out/main/index.js`，以独立沙箱执行字符串表解码函数而非启动应用代码：

- 18172–18206 行：容器严格识别 `encryption == "safeStorage.v1"` 且 `data` 为字符串；`data` 是 `safeStorage.encryptString(明文).toString("base64")`，读时 `safeStorage.decryptString(Buffer.from(data,"base64"))`。
- 18978 行：文件位于 `app.getPath("userData")/bridge-store/token-store.json`。
- 19201–19249 行：解密 JSON 为 `{origin,tokens,accountRegion}`，tokens 键包括 `access_token`、`refresh_token`、匿名 token、`msh_user_id`、`msh_user_subscription_data`。旧明文包装/旧裸 token map 也可读取，旧裸 map 的 origin 默认 `https://www.kimi.com`。官方检查 origin 与当前应用 origin 一致，避免错环境 token 混用；Maclawd 只读，不照搬官方写回迁移。
- 解密失败时官方保留源文件并启动空缓存，不抹除 token-store。官方 token 刷新有单飞锁、已推进 token 重读和强制刷新循环抑制；外部程序不应直接覆盖桌面凭据文件与官方竞争。

### 不弹窗的 Security API 建议

用进程内或自有受控 helper 的 `SecItemCopyMatching`，限定 `kSecClassGenericPassword`、精确 `kSecAttrService`、`kSecAttrAccount`、`kSecMatchLimitOne`、`kSecReturnData`。非交互查询同时传 `LAContext.interactionNotAllowed = true` / `kSecUseAuthenticationContext` 和 `kSecUseAuthenticationUIFail`，可参考 SweetCookieKit 的双重策略。Apple 已弃用后者并建议 LAContext，保留兼容策略应明确其目的，不改用允许 UI 的查询。

`errSecItemNotFound`、`errSecInteractionNotAllowed`、`errSecAuthFailed` 应分别归类为未发现、需要用户授权/当前不可交互、访问拒绝；任一失败不回退 `/usr/bin/security ... -w`，不调用 `SecItemAdd/Update/Delete`，不运行会创建新 Safe Storage 密码的 Chromium `GetPassword()`。不通过宽泛 Keychain 枚举猜条目；不输出密码、解密 token、Cookie 或完整 HTTP 响应。

直接依据：[Electron 主进程](https://github.com/electron/electron/blob/7d9a629ab84ad83ec4761be5b9fbc7d16de5c37c/shell/browser/electron_browser_main_parts.cc)、[Chromium Cookie store](https://github.com/chromium/chromium/blob/5403439e4c2c2216f4636559e8c71e008f73b774/net/extras/sqlite/sqlite_persistent_cookie_store.cc)、[SweetCookieKit](https://github.com/steipete/SweetCookieKit/blob/881be74146f1100e10e04d67f566793e08a700e3/Sources/SweetCookieKit/ChromeCookieImporter.swift)、[browser_cookie3](https://github.com/borisbabic/browser_cookie3/blob/03895797e48dd107806db171d8392c562151807d/browser_cookie3/__init__.py)、[Apple 非交互策略](https://developer.apple.com/documentation/security/ksecuseauthenticationuifail)。
