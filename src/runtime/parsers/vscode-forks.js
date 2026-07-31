import { statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';

/**
 * Cline 与 Roo Code 是 VSCode 扩展，用量存在宿主的 globalStorage 里。
 * 两者字段完全同构，所以共用这一层；差别只有扩展 id 与任务索引文件名。
 *
 * 必须遍历**所有** VSCode 系宿主——很多人在 Cursor 或 Windsurf 里装 Cline，
 * 只看 Code 会让这些人的数据完全不可见。
 */

const HOSTS = [
  'Code', 'Code - Insiders', 'VSCodium',
  'Cursor', 'Windsurf', 'Trae', 'Trae CN',
];

export function hostRoots() {
  const override = process.env.MACLAWD_VSCODE_ROOTS?.trim();
  if (override) return override.split(':').filter(Boolean);

  if (platform() === 'darwin') {
    const base = join(homedir(), 'Library', 'Application Support');
    return HOSTS.map((h) => join(base, h));
  }
  if (platform() === 'win32') {
    const appData = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
    return HOSTS.map((h) => join(appData, h));
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return HOSTS.map((h) => join(xdg, h));
}

export function extensionDirs(extensionId) {
  const dirs = [];
  for (const root of hostRoots()) {
    const dir = join(root, 'User', 'globalStorage', extensionId);
    try {
      if (statSync(dir).isDirectory()) dirs.push(dir);
    } catch {
      // 该宿主没装这个扩展
    }
  }
  return dirs;
}

/**
 * 任务条目 → 规范化记录。
 *
 * `tokensIn` 是**非缓存**输入（cacheWrites / cacheReads 都是独立字段），
 * 所以三项互斥，不需要减法。
 */
export function taskToRecord(info, { source, fallbackModel = null }) {
  if (!info || typeof info !== 'object') return null;
  const input = pickCount(info, 'tokensIn', 'tokens_in');
  const output = pickCount(info, 'tokensOut', 'tokens_out');
  const cacheWrite = pickCount(info, 'cacheWrites', 'cache_writes');
  const cacheRead = pickCount(info, 'cacheReads', 'cache_reads');
  if (input + output + cacheWrite + cacheRead === 0) return null;

  const stamp = info.ts ?? info.timestamp ?? info.lastMessageTs;
  const ts = typeof stamp === 'number' ? stamp : new Date(stamp).getTime();
  if (!Number.isFinite(ts)) return null;

  const cwd = typeof info.cwd === 'string' ? info.cwd
    : typeof info.workspace === 'string' ? info.workspace
      : null;

  return {
    source,
    input,
    output: toCount(output),
    cacheRead,
    write5m: cacheWrite,
    write1h: 0,
    reasoning: 0,
    model: String(info.model ?? info.apiModelId ?? fallbackModel ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
    cwd,
    ts,
    // 任务 id 全局唯一，正好当去重键——同一任务在多个宿主里出现时会自然折叠。
    messageId: info.id ? String(info.id) : `${source}|${ts}|${input}|${output}`,
    requestId: null,
    uuid: null,
    sidechain: false,
  };
}

/**
 * 构造一个「读整份任务索引 JSON」的解析器。
 * 索引可能是数组，也可能是 { taskHistory: [...] } 这类包裹形态。
 */
export function createTaskIndexParser({ id, label, extensionId, indexFiles }) {
  return {
    id,
    label,
    readMode: 'whole',
    lineFilter: null,

    dataDirs: () => extensionDirs(extensionId),

    discover({ listJsonl }) {
      const candidates = [];
      for (const dir of extensionDirs(extensionId)) {
        for (const { path, size, mtimeMs, ino } of listJsonl(dir, { extensions: ['.json'] })) {
          const name = path.slice(dir.length + 1);
          if (!indexFiles.some((f) => name === f || name.endsWith(`/${f}`))) continue;
          candidates.push({ path, size, mtimeMs, ino, sessionId: path, fallbackProject: null });
        }
      }
      return candidates;
    },

    createFileParser() {
      const records = [];
      return {
        onObject(root) {
          const list = Array.isArray(root) ? root
            : Array.isArray(root?.taskHistory) ? root.taskHistory
              : Array.isArray(root?.tasks) ? root.tasks
                : root && typeof root === 'object' ? [root] : [];
          for (const info of list) {
            const record = taskToRecord(info, { source: id });
            if (record) records.push(record);
          }
        },
        finish() {
          return { records, state: null };
        },
      };
    },
  };
}
