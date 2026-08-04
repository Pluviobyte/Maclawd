# Vibe Usage 运行时生命周期调研

调研日期：2026-08-04

一手来源：

- CLI 官方仓库 [`vibe-cafe/vibe-usage`](https://github.com/vibe-cafe/vibe-usage)，审阅提交 [`a496751`](https://github.com/vibe-cafe/vibe-usage/commit/a4967515b770264d61c53cab1a29752bfb31bce6)（CLI `0.10.7`）
- macOS App 官方仓库 [`vibe-cafe/vibe-usage-app`](https://github.com/vibe-cafe/vibe-usage-app)，审阅提交 [`9c76203`](https://github.com/vibe-cafe/vibe-usage-app/commit/9c762033be1a1109019840495432930d873669ec)（App `0.5.7` / build `28`）

## 结论

Vibe Usage **没有采用“Mac App 启动一个常驻、本地端口监听的 Node 服务”这套架构**。官方其实提供两种相互独立的连续同步方式：

1. **Mac App 模式**：Swift App 自己常驻菜单栏、自己持有 30 分钟定时器；每次同步临时执行 `bun x @vibe-cafe/vibe-usage@latest sync` 或 `npx --yes @vibe-cafe/vibe-usage@latest sync`，命令完成后子进程退出。没有本地 HTTP 端口、PID 文件、健康接口或运行时版本握手。
2. **CLI daemon 模式**：用户显式安装一个 systemd user service 或 macOS LaunchAgent，由系统服务管理器保证和重启一个前台无限循环的 CLI 进程。它同样不监听端口，也没有健康/版本协议。

因此，Vibe Usage 没有解决 Maclawd 当前的“新 App 误复用旧本地服务”问题；它通过**不让 App 拥有这种长命、可跨 App 版本存活的本地服务**来规避该问题。

## 1. Mac App 的实际架构

### 1.1 启动与周期同步

App 启动后创建 `AppState`，调用 `initialize()`；若本地已有 API key，就启动 App 内部的同步调度器（[`VibeUsageApp.swift` L17-L25](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/App/VibeUsageApp.swift#L17-L25)、[`AppState.swift` L236-L260](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Models/AppState.swift#L236-L260)）。

`SyncScheduler` 是 App 进程内的 `DispatchSourceTimer`，默认每 1800 秒触发一次；`start()` 有一个仅限该对象的 `started` 标志，防止同一个 scheduler 被重复启动（[`SyncScheduler.swift` L3-L39](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/SyncScheduler.swift#L3-L39)）。启动 scheduler 时，App 还会立即并行读取一次仪表盘并执行一次完整同步（[`AppState.swift` L465-L475](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Models/AppState.swift#L465-L475)）。

### 1.2 CLI 是一次性子进程，不是后台服务

运行时探测器优先选择 Bun，其次选择 npx，并将包名固定为 `@vibe-cafe/vibe-usage@latest`：

- Bun：`bun x @vibe-cafe/vibe-usage@latest sync`
- npm：`npx --yes @vibe-cafe/vibe-usage@latest sync`

见 [`RuntimeDetector.swift` L3-L23](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/RuntimeDetector.swift#L3-L23) 及运行时选择逻辑 [`L115-L134`](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/RuntimeDetector.swift#L115-L134)。

`SyncEngine` 每次都新建 Foundation `Process`，等待其退出并读取 stdout/stderr；120 秒仍在运行时调用 `terminate()`（[`SyncEngine.swift` L41-L117](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/SyncEngine.swift#L41-L117)）。源码没有把这个 Process 保存为跨同步复用的 runtime，也没有任何 server/listen/port 逻辑。

这意味着一次同步结束后不存在等待下一次请求的旧 CLI 进程，App 升级或重启后自然会在下一次同步重新解析 `@latest`。

### 1.3 单实例/并发处理

`SyncEngine` 是一个进程内共享 actor，并用 `isRunning` 拒绝同一 App 进程内的重叠同步（[`SyncEngine.swift` L4-L39](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/SyncEngine.swift#L4-L39)）。`AppState.triggerSync()` 还有一层 UI 状态 guard（[`AppState.swift` L301-L323](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Models/AppState.swift#L301-L323)）。

但这不是系统级单实例锁：仓库中没有 lock file、PID file、Unix socket，也没有 `LSMultipleInstancesProhibited`。它只防止一个 App 进程自身重复同步；若人为启动两个 App 进程或另开 CLI，两边仍可各自同步。

### 1.4 端口冲突、旧进程、健康检查

Mac App 模式没有本地监听端口，因此不存在端口占用时“接管还是复用”的分支。源码中也没有：

- 按端口发现旧服务；
- 对旧 PID 做身份校验或发信号；
- `/health`、`/ping`、协议版本或 build ID 握手；
- 先启动新服务、健康检查通过后再切换的滚动替换。

唯一接近“健康”的判断是一次性 CLI 的退出码与输出；退出码为 0 即成功，否则映射为认证失败或进程失败（[`SyncEngine.swift` L82-L116](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/SyncEngine.swift#L82-L116)）。

### 1.5 版本升级

App 自身通过 Sparkle 更新。`Info.plist` 配置 GitHub Releases 的 appcast、自动检查和 8 小时间隔（[`Info.plist` L32-L41](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Info.plist#L32-L41)），`UpdaterViewModel` 初始化 `SPUStandardUpdaterController`（[`UpdaterViewModel.swift` L20-L35](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/UpdaterViewModel.swift#L20-L35)）。

CLI 版本没有与 App 打包绑定，而是每次命令使用 `@latest`。App 会通过环境变量把自己的 surface 和版本传给 CLI（[`AppConfig.swift` L3-L9](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Models/AppConfig.swift#L3-L9)、[`SyncEngine.swift` L51-L67](https://github.com/vibe-cafe/vibe-usage-app/blob/9c762033be1a1109019840495432930d873669ec/VibeUsage/Services/SyncEngine.swift#L51-L67)）。CLI 再把 `collectorVersion`、`surfaceVersion`、JS runtime 版本等作为上传元数据发送给远端 ingest API（[`client-meta.js` L4-L35](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/client-meta.js#L4-L35)、[`sync.js` L233-L251](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/sync.js#L233-L251)）。这是**远端采集元数据**，不是本地 App 与 daemon 之间的兼容性握手。

这里的取舍是：App 与 CLI 可以独立发版，但 `@latest` 也意味着 App 没有锁定/验证一个明确兼容的 CLI 协议版本；其安全性依赖 CLI 向后兼容和 npm/Bun 的解析缓存行为。

## 2. 独立 CLI daemon 的做法

官方 README 明确把 CLI daemon 和 Mac App 并列为两种连续同步方式（[`README.md` L82-L89](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/README.md#L82-L89)）。Mac App 源码没有调用 `daemon install`，所以不能把下面这套 lifecycle 当作 App 的内部 runtime 管理。

### 2.1 进程模型

`vibe-usage daemon` 是一个前台无限循环：立即同步，随后休眠 30 分钟；普通同步错误只记录并继续。连续 5 次 401 后以 code 1 退出，让服务管理器接管（[`daemon.js` L5-L52](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon.js#L5-L52)）。

### 2.2 macOS 启停和单实例

`daemon install` 写入固定文件 `~/Library/LaunchAgents/ai.vibecafe.vibe-usage.plist`，label 也是 `ai.vibecafe.vibe-usage`。plist 中：

- `ProgramArguments` 固定为安装当时的 `process.execPath`、CLI 的绝对 `binPath` 和 `daemon`；
- `RunAtLoad=true`；
- `KeepAlive=true`；
- stdout/stderr 写到 `~/.vibe-usage/daemon.log` 和 `daemon.err`。

见 [`daemon-service.js` L8-L42](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L8-L42) 和 [`L95-L134`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L95-L134)。

这里的“单实例”由 launchd 的唯一 job label 间接提供，而不是 daemon 自身的锁。前台手动运行多个 `vibe-usage daemon` 没有防重机制。

启动使用 `launchctl load <plist>`；若 plist 已存在，`install` 直接拒绝覆盖并要求用户 restart 或 uninstall（[`daemon-service.js` L149-L198](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L149-L198)）。停止不用 `launchctl stop`，因为 `KeepAlive` 会立刻拉起；实现选择 `launchctl unload`。重启则是 `unload` 再 `load`（[`daemon-service.js` L265-L311](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L265-L311)）。卸载会先 unload，再删除 plist（[`daemon-service.js` L205-L231](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L205-L231)）。

这套做法比自行按 PID 杀进程更安全：生命周期和 job 身份交给 launchd，停止/重启针对已知 plist/job，而非扫描端口猜进程。

### 2.3 升级与旧进程的局限

CLI daemon 没有自动版本替换协议：

- 已安装时不会重写 plist，因此 runtime/bin 路径变化不会自动纠正。
- plist 指向安装时的绝对路径；从 npx 缓存安装时源码会明确警告缓存清理后 daemon 会失效，并建议全局安装（[`daemon-service.js` L23-L31](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L23-L31)、[`L157-L169`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L157-L169)）。
- 全局 npm 包若原路径被原地更新，当前已运行的 Node 进程仍需 restart 才会加载新代码；源码没有发现版本变化后自动 restart 的逻辑。
- `status` 只是调用 `launchctl list <label>`，能说明 job 是否运行，不能证明其版本、协议兼容性或业务健康（[`daemon-service.js` L234-L263](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon-service.js#L234-L263)）。

daemon 也不监听网络端口，所以没有端口冲突与端口身份验证问题。

## 3. 对 Maclawd 的可借鉴部分

### 如果保持当前“App + 常驻本地 HTTP runtime”

Vibe Usage 没有可直接照搬的实现。Maclawd 仍需要自己的：

- 明确的 runtime identity（随机管理 token、bundle/build identity、PID/可执行路径）；
- `/health` 或 `/ping` 返回 protocol version、runtime build ID、PID、startedAt；
- App 在复用前校验兼容性；
- 不兼容时通过受保护管理通道优雅退出，超时后仅对已验证身份的进程 `SIGTERM`；
- 新 runtime 健康通过后再切换。

### 如果采用 Vibe Usage Mac App 的思路

可以取消常驻 HTTP runtime：由 Swift App 自己调度，每次采集启动一个一次性 CLI 子进程，完成即退出。这样端口、旧 runtime、协议握手和跨版本接管问题都会消失；代价是每次启动 Node/Bun/CLI 的延迟，以及不能在 App 退出后持续采集。

### 如果要求 App 退出后仍持续采集

更接近 Vibe Usage CLI daemon 的做法是用用户级 LaunchAgent 管理一个独立服务，但应比其当前实现多做一步：安装/升级时幂等地重写并 bootstrap/kickstart 固定 label 的 plist，服务暴露可验证的版本/健康信息，App 不直接扫描或杀 PID。若 HTTP API 并非必要，还可以采用“LaunchAgent 定时执行一次性同步任务”，进一步消除常驻端口。

## 4. 最终判断

Vibe Usage 的 Mac App 做法对“额度/用量每隔一段时间采集一次”的场景很实用：短命 `@latest` CLI 让升级与旧进程问题大幅简化。它不是“版本握手 + 自动替换旧后台服务”的参考实现，也不能证明 Maclawd 当前服务复用方案应省略握手。

如果 Maclawd 的额度 runtime 只服务于 App、且无需 App 退出后继续运行，**一次性子进程是比补齐完整服务接管协议更简单的架构候选**。如果 runtime 还承载实时事件、多个客户端或持续采集，则保留服务并实现版本握手/安全替换，或交给 LaunchAgent 管理，仍然更合适。
