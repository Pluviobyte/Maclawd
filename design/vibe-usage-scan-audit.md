# vibe-usage 本地扫描机制审计

审计日期：2026-08-04

上游：[`vibe-cafe/vibe-usage`](https://github.com/vibe-cafe/vibe-usage)

检查的精确版本：[`a4967515b770264d61c53cab1a29752bfb31bce6`](https://github.com/vibe-cafe/vibe-usage/commit/a4967515b770264d61c53cab1a29752bfb31bce6)（仓库版本 `0.10.7`，提交时间 2026-08-02 17:31:48 +08:00）。以下结论只针对该提交；链接均固定到此 revision。

## 结论摘要

vibe-usage 的守护进程不会在冷启动积压未完成时立即续扫。它启动后先同步一次，随后无条件等待 30 分钟；下一次同步完成后又等待 30 分钟。换言之，它没有“扫到 backlog 清空为止”的快速循环。[`daemon.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon.js#L5-L54)

它在大量 Codex 历史文件上的主要优势不是调度，而是扫描器本身：

- 为每个 Codex 文件持久化 header 和最终聚合结果；只有 fork、sub-agent、被引用父会话、重复副本或损坏 header 等特殊文件才保存完整回放索引。文件签名未变时直接复用。
- 对普通追加写入的 rollout 保存 tail 状态，下次只从上次字节偏移继续读取，再与旧聚合结果合并。
- JSONL 使用流式逐行读取，并把读取上限固定为发现时的文件大小，避免整文件载入内存，也避免扫描过程中追加造成两次 pass 不一致。
- 普通会话只做轻量 header discovery 和一次 usage pass；只有 fork、sub-agent、被引用父会话、重复副本或损坏 header 才建立完整回放索引。
- 所有 parser、Codex 文件处理和上传 batch 都是顺序执行，没有文件级并发。

## 1. 冷启动调度和续扫

Codex 缓存开启且 stdout 非 TTY 时，单次 parser 的默认工作预算是 105 秒。这是为了在 macOS app 120 秒的 child 超时前写入 checkpoint。交互式 TTY 默认没有时间预算，可在一次手动同步里跑完；环境变量 `VIBE_USAGE_CODEX_WORK_BUDGET_MS` 可以覆盖预算。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L463-L474)

预算会在三个阶段间检查：header discovery、replay index、usage parsing。超时时返回空 buckets/sessions、`skipped: true` 和 `{ phase, completed, total }`；此前写入的逐文件缓存保留，下一次调用从缓存继续。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L873-L953) [`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L968-L1020)

但 `runSync()` 只把 indexing 状态显示为“下次同步继续”，不会在当前调用内再次调用 parser。[`sync.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/sync.js#L77-L150)

daemon 的循环是 `runSync()` → 固定 sleep 30 分钟。因此后台冷启动可能跨多个 30 分钟周期完成；没有根据 `indexing` 或 `skipped` 缩短重试间隔，也没有 loop-until-complete。[`daemon.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/daemon.js#L5-L54)

## 2. 文件发现

Codex roots 包含主 `$CODEX_HOME`（默认 `~/.codex`）和可选 extra home。每个 root 同时扫描 `sessions` 与 `archived_sessions`，避免会话归档移动后漏数。[`codex-roots.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/codex-roots.js#L14-L29)

文件发现对上述目录递归调用同步 `readdirSync`，收集所有 `.jsonl`；之后逐个 `statSync`，跳过空文件。目录不可读或文件恰好移动会被忽略，留到下次同步。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L21-L53) [`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L812-L858)

这意味着每次同步仍有 O(文件数) 的目录遍历和 stat 成本；缓存省掉的是文件内容重读，不是 discovery。

## 3. 缓存与增量读取

Codex parser cache 与上传状态分开：

- parser cache 位于 `~/.vibe-usage/cache/codex/root-<hash>/`，每个源文件有 summary JSON 和 tail JSON。
- summary cache 以 `size + mtimeMs + dev + ino` 的完整签名命中，并校验 schema、算法版本和原路径。
- 写入使用同目录随机临时文件后 atomic rename；缓存损坏只视为 cache miss，不影响正确性。

来源：[`codex-cache.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex-cache.js#L12-L111)

追加尾读要求同一设备与 inode、文件变大、mtime 不倒退、上次恰好读到换行结尾，并用末尾 4096 字节的 guard hash 验证旧前缀没有被改写。成立时从 `parsedBytes` 开始流式读新增部分，并将新 bucket/session accumulator 合并到旧结果；若新事件时间倒退，则放弃 tail 优化、整文件重建。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L143-L176) [`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L583-L774)

上层另有上传增量状态 `~/.vibe-usage/state.json`：parser 仍提供完整 live view，sync 用稳定 key 与内容 hash 只上传新增/变化的 bucket/session。上传成功后才提交相应 hash；失败 batch 下次精确重试。[`state.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/state.js#L6-L18) [`sync.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/sync.js#L172-L209) [`sync.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/sync.js#L236-L277)

## 4. 大文件处理

rollout 通过 `createReadStream` + `readline` 逐行处理，不使用 `readFile` 将 JSONL 整体载入内存。每轮先记录 `snapshotSize`，stream 的 `end` 固定为 `snapshotSize - 1`；live append 延后到下次同步，保证同轮各 pass 看到相同前缀。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L55-L69)

普通会话只读到首个 `session_meta` 完成 discovery，随后做一次 usage pass。需要处理 fork/sub-agent replay 的文件才做完整 index pass，再做 usage pass，因此特殊大文件冷启动可能被完整流式读取两遍。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L106-L133) [`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L916-L953)

暖缓存还有滚动正确性审计：只有全部文件已有 header/result 时启用，每次最多重读一个、默认不超过 64 MiB、且距上次审计至少 30 天的文件。超过 64 MiB 的活跃文件仍通过 stat 签名即时失效，但不会被这项周期性全量审计选中。[`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L476-L488) [`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L860-L871)

## 5. 并发模型

`runSync()` 用 `for ... of` 逐个 `await` 所有工具 parser；Codex parser 内的 discovery/index/usage 三个文件循环也是逐文件 `await`；上传 batches 同样逐批 `await ingest()`。该 revision 没有 worker pool、`Promise.all` 或文件级并发。[`sync.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/sync.js#L79-L116) [`codex.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/codex.js#L873-L954) [`sync.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/sync.js#L239-L277)

Claude Code parser 与 Codex 不同：它会每轮递归发现并顺序流式重读所选会话文件，没有同类逐文件 parser cache/tail cache。它按 session id 在多个 roots 中选择最大/最新副本，并固定 discovery 时的大小读取。[`claude-code.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/claude-code.js#L22-L124) [`claude-code.js`](https://github.com/vibe-cafe/vibe-usage/blob/a4967515b770264d61c53cab1a29752bfb31bce6/src/parsers/claude-code.js#L267-L307)

## 6. 对 Maclawd 的可执行建议

1. **保留已计划的 backlog 快速续扫。** vibe-usage 的固定 30 分钟 cadence 不值得照搬。Maclawd 单轮只有约 20 秒时，若仍固定等待 30 分钟，会把数分钟的 CPU 工作拉长成数小时。扫描返回 unfinished/backlog 时应在短间隔（例如 2–5 秒，可加轻微退避）再次运行；清空后恢复 30 分钟。

2. **借鉴其 Codex 逐文件三级缓存。** 至少持久化文件签名、解析结果、尾读 byte offset 与聚合 accumulator。只提高续扫频率能缩短墙钟时间，却不能降低累计 I/O；逐文件缓存才能让每轮真正只处理未完成或变化的文件。

3. **采用受保护的 append-tail，而不是仅凭 mtime/size。** 保存 inode/device、旧 size、末尾 guard hash 和 newline 状态，可在文件 append 时安全地只读尾部；任何不满足条件的情况自动退回全读。

4. **大 JSONL 必须流式并固定 snapshot boundary。** 对 100–300 MiB 文件不要 `readFile`/split 全载入；先 stat，再用字节上限读稳定前缀。若 parser 需要两遍，两个 pass 必须使用同一个 snapshot size。

5. **并发应谨慎、限宽。** vibe-usage 完全顺序处理，内存和磁盘压力可控。Maclawd 若为了首次索引加速并行，建议仅 2–4 个文件 worker，并将超大文件单独限流；不要对数百个 JSONL 直接 `Promise.all`。

6. **把“扫描进度”和“数据完整性”分开。** 未完成轮次应 checkpoint 但不把部分工具视为完整快照，也不要据此清除旧缓存/聚合。vibe-usage 用 `skipped: true` 避免把半成品当成功结果，这一点值得保留。

7. **完成条件由扫描结果驱动。** daemon 需要明确消费 `hasBacklog`/`indexing`，而不是仅依赖 timer。应防止重入：一轮结束后再 schedule 下一轮；应用退出或设置关闭时取消 short retry。

总体判断：Maclawd 应结合“自己的短间隔 backlog drain”与“vibe-usage 的逐文件缓存、tail 增量和流式快照”。前者解决用户看到的等待时长，后者解决 9 GiB 级历史数据的累计磁盘读取成本。
