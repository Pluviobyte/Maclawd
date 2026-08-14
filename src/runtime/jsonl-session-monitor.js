import { openSync, closeSync, readSync, readdirSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';

/**
 * 通用 JSONL 会话尾随器：把「实时看见一个 agent 在干什么」这件事，
 * 从 hook 之外再补一条**不需要用户授权**的通道。
 *
 * **为什么必须是通用的。** 原来只有 Codex 有这个兜底，Claude Code 没有。
 * 于是同一个开关关闭时，两个 agent 的降级结果完全不同：Codex 仍然可见，
 * Claude Code 直接从面板上消失——而 Claude Code 恰恰是主力场景，
 * 它的 transcript 就躺在 ~/.claude/projects 里持续写入，只是没人读。
 * 用户看到的是「我明明开着 Claude Code，实时会话却空着」，没有任何线索。
 *
 * 各家 JSONL 的差异只有两处：**去哪儿找文件**、**一行怎么翻译成事件**。
 * 其余全是同一套难写对的机制，必须只有一份实现：
 *
 *   · **首次见到的文件绝不回放历史。** 尾部的 Stop / SessionStart 会在每次
 *     启动时炸出一串假的「完成庆祝」和「启动」动画。首见只读文件头学身份，
 *     一个事件都不发；在途会话由 hook 的租约负责恢复。
 *   · **半行要留到下一轮。** agent 正写到一半时读到的最后一行是残缺的，
 *     直接 JSON.parse 会丢掉那个事件。
 *   · **文件被截断/轮转要归零重来**，否则偏移量永远超过文件长度，从此不再产出。
 *   · **单轮读取有上限**，避免一个刚被写入几十兆的文件把事件循环堵住。
 *
 * watch 只作低延迟触发器，真正的偏移与半行处理全部收敛在 poll() 一条路上；
 * 定时轮询保留作为「watch 失效 / 目录还没建」的自愈兜底。
 */

/** 一轮最多看几个文件。按 mtime 取最近的，够覆盖同时开着的会话数。 */
export const MAX_TAILED_FILES = 20;
/** 多久没动过就不再跟。 */
export const STALE_MS = 24 * 60 * 60_000;
/** 首见时读多少字节来学身份。 */
export const HEAD_BYTES = 64 * 1024;
/** 单轮单文件最多读多少。 */
export const CHUNK_BYTES = 256 * 1024;

function recentFiles(roots, now, maxFiles) {
  const found = [];
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const path = join(entry.parentPath ?? entry.path ?? root, entry.name);
        try {
          const stat = statSync(path);
          if (now - stat.mtimeMs < STALE_MS) found.push({ path, stat });
        } catch { /* 刚被删掉：跳过 */ }
      }
    } catch { /* 目录不存在或不可读：这个 agent 没装，安静跳过 */ }
  }
  return found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, maxFiles);
}

/**
 * @param {object}   opts
 * @param {() => string[]} opts.roots        轮询哪些目录
 * @param {() => string[]} [opts.watchRoots] 监听哪些目录（默认同 roots）
 * @param {(row: object, context: object) => object|null} opts.toEvent
 *        一行 → 引擎事件。返回 null 表示这一行不值得上报。
 * @param {(row: object, context: object) => object} [opts.learnContext]
 *        从一行里学会话身份（id / cwd）。**只学不报**，首次扫描文件头时
 *        只会调用它，不会调用 toEvent。
 * @returns {() => void} stop
 */
export function createJsonlSessionMonitor({
  roots,
  watchRoots = roots,
  toEvent,
  learnContext = (_row, context) => context,
  onEvent,
  intervalMs = 1000,
  now = Date.now,
  watchImpl = watch,
  maxFiles = MAX_TAILED_FILES,
} = {}) {
  const offsets = new Map();
  const contexts = new Map();
  const remainders = new Map();
  const watchers = [];
  let watchTimer = null;

  function read(path, start, length) {
    const buffer = Buffer.alloc(length);
    let fd;
    try {
      fd = openSync(path, 'r');
      const bytes = readSync(fd, buffer, 0, length, start);
      return buffer.subarray(0, bytes);
    } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
  }

  function parseLines(text, handle) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      handle(row);
    }
  }

  function poll() {
    for (const { path, stat } of recentFiles(roots(), now(), maxFiles)) {
      const prior = offsets.get(path);
      if (prior === undefined) {
        // 首见：只读头部学身份，一个事件都不发。
        const head = read(path, 0, Math.min(stat.size, HEAD_BYTES));
        let context = {};
        parseLines(head?.toString('utf8') ?? '', (row) => {
          context = learnContext(row, context) ?? context;
        });
        contexts.set(path, context);
        offsets.set(path, stat.size);
        continue;
      }
      const start = prior;
      if (stat.size < start) {
        // 截断或轮转：忘掉一切重新开始，否则偏移量永远追不上。
        offsets.set(path, 0); contexts.delete(path); remainders.delete(path); continue;
      }
      if (stat.size === start) continue;
      const length = Math.min(stat.size - start, CHUNK_BYTES);
      const chunk = read(path, start, length);
      if (!chunk) continue;
      offsets.set(path, start + length);
      const complete = Buffer.concat([remainders.get(path) ?? Buffer.alloc(0), chunk]);
      const boundary = complete.lastIndexOf(0x0a);
      if (boundary < 0) { remainders.set(path, complete); continue; }
      remainders.set(path, complete.subarray(boundary + 1));
      let context = contexts.get(path) ?? {};
      parseLines(complete.subarray(0, boundary).toString('utf8'), (row) => {
        context = learnContext(row, context) ?? context;
        contexts.set(path, context);
        const event = toEvent(row, context);
        if (event) onEvent?.(event);
      });
    }
  }

  // 固定轮询平均要等半个周期，对「刚开始工具 / 刚结束」的桌宠状态是能被
  // 人感知的延迟。watch 把它压到 15ms 级别，同时不改变数据通路。
  const schedulePoll = () => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      watchTimer = null;
      poll();
    }, 15);
    watchTimer.unref?.();
  };

  poll();
  for (const dir of watchRoots()) {
    try {
      const watcher = watchImpl(dir, { recursive: true }, schedulePoll);
      watcher.on?.('error', () => {});
      watcher.unref?.();
      watchers.push(watcher);
    } catch {
      // 目录尚未生成、系统不支持 recursive watch 或权限变化时，
      // 下面的 interval 仍能恢复，不让优化变成新的单点故障。
    }
  }
  // 堵住「首次 poll 完成到 watcher 装好」之间的极短窗口。
  poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    if (watchTimer) clearTimeout(watchTimer);
    for (const watcher of watchers) watcher.close?.();
  };
}
