import { openSync, closeSync, readSync, readdirSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { sessionDirs } from './parsers/codex.js';

function recentFiles(root, now) {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(entry.parentPath ?? entry.path ?? root, entry.name))
      .map((path) => ({ path, stat: statSync(path) }))
      .filter(({ stat }) => now - stat.mtimeMs < 24 * 60 * 60_000)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, 20);
  } catch { return []; }
}

export function codexJsonlEvent(row, context = {}) {
  const payload = row?.payload ?? {};
  const type = row?.type;
  const base = {
    sessionId: context.sessionId ?? 'default', agentId: 'codex', channel: 'jsonl',
    cwd: context.cwd,
  };
  if (type === 'session_meta') {
    return { ...base, type: 'SessionStart', sessionId: payload.id ?? base.sessionId, cwd: payload.cwd };
  }
  if (type === 'turn_context') return { ...base, type: 'UserPromptSubmit', cwd: payload.cwd ?? base.cwd };
  if (type === 'event_msg') {
    if (['task_started', 'turn_started'].includes(payload.type)) return { ...base, type: 'UserPromptSubmit' };
    if (['task_complete', 'turn_complete', 'turn_completed'].includes(payload.type)) {
      return { ...base, type: 'Stop', disposition: 'complete' };
    }
    if (['turn_aborted', 'task_aborted'].includes(payload.type)) {
      return { ...base, type: 'Stop', disposition: 'interrupted' };
    }
  }
  if (type === 'response_item') {
    const toolTypes = new Set(['function_call', 'custom_tool_call', 'local_shell_call']);
    if (toolTypes.has(payload.type)) {
      const name = payload.name ?? (payload.type === 'local_shell_call' ? 'Bash' : 'Tool');
      return { ...base, type: 'PreToolUse', toolName: name };
    }
  }
  return null;
}

export function createCodexSessionMonitor({
  onEvent, intervalMs = 1000, now = Date.now, watchImpl = watch,
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

  function poll() {
    for (const { path, stat } of recentFiles(sessionDirs()[0], now())) {
      const prior = offsets.get(path);
      // Never replay history on first sight. A completed Stop/SessionStart from the
      // tail would create a false celebration/launch animation at every app start.
      // Official hooks + leases recover in-flight sessions; JSONL stays a realtime,
      // best-effort fallback from this point forward.
      if (prior === undefined) {
        // Read only the beginning to learn identity/project, but emit nothing from
        // history. session_meta is at the head of Codex rollouts.
        const head = read(path, 0, Math.min(stat.size, 64 * 1024));
        for (const line of (head?.toString('utf8') ?? '').split('\n')) {
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          if (row.type === 'session_meta') {
            contexts.set(path, { sessionId: row.payload?.id, cwd: row.payload?.cwd });
            break;
          }
        }
        offsets.set(path, stat.size);
        continue;
      }
      const start = prior;
      if (stat.size < start) {
        offsets.set(path, 0); contexts.delete(path); remainders.delete(path); continue;
      }
      if (stat.size === start) continue;
      const length = Math.min(stat.size - start, 256 * 1024);
      const chunk = read(path, start, length);
      if (!chunk) continue;
      offsets.set(path, start + length);
      const complete = Buffer.concat([remainders.get(path) ?? Buffer.alloc(0), chunk]);
      const boundary = complete.lastIndexOf(0x0a);
      if (boundary < 0) { remainders.set(path, complete); continue; }
      const lines = complete.subarray(0, boundary).toString('utf8').split('\n');
      remainders.set(path, complete.subarray(boundary + 1));
      let context = contexts.get(path) ?? {};
      for (const line of lines) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row.type === 'session_meta') {
          context = { sessionId: row.payload?.id, cwd: row.payload?.cwd };
          contexts.set(path, context);
        } else if (row.type === 'turn_context' && row.payload?.cwd) {
          context.cwd = row.payload.cwd;
        }
        const event = codexJsonlEvent(row, context);
        if (event) onEvent?.(event);
      }
    }
  }

  // Codex GUI 会持续追加 rollout JSONL。固定 1s 轮询平均要等 500ms，
  // 这对「刚开始工具 / 刚结束」的桌宠状态已经能被人感知。
  // fs.watch 只作为低延迟触发器：真正的 offset、半行和轮转处理仍全部走
  // poll() 这一条路；原来的定时器保留作为丢事件/目录新建时的自愈兜底。
  const schedulePoll = () => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      watchTimer = null;
      poll();
    }, 15);
    watchTimer.unref?.();
  };

  poll();
  for (const dir of sessionDirs()) {
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
