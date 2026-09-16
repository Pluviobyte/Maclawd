import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { createTurnTracker } from '../sessions.js';

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
    } catch (err) {
      // 该宿主没装这个扩展
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
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
  const items = root => Array.isArray(root) ? root
    : root?.entries ?? root?.taskHistory ?? root?.tasks ?? (root && typeof root === 'object' ? [root] : []);
  return {
    id,
    label,
    readMode: 'whole',
    lineFilter: null,

    dataDirs: () => extensionDirs(extensionId),

    discover({ listJsonl }) {
      const candidates = [];
      for (const dir of extensionDirs(extensionId)) {
        const files = listJsonl(dir, { extensions: ['.json'] });
        const byPath = new Map(files.map(file => [file.path, file]));
        const indexes = [], tasks = new Map();
        // The global index is a disposable cache. Per-task metadata, if present,
        // is authoritative and overrides a stale index entry.
        for (const file of [...files].sort((a, b) => Number(basename(a.path) === 'history_item.json') - Number(basename(b.path) === 'history_item.json'))) {
          const name = file.path.slice(dir.length + 1);
          if (!indexFiles.some((f) => name === f || name.endsWith(`/${f}`))) continue;
          const list = items(JSON.parse(readFileSync(file.path, 'utf8')));
          if (!Array.isArray(list)) throw new Error(`${id}: 任务索引格式不支持`);
          indexes.push({ file, list });
          for (const item of list) {
            if (!item?.id || /[\\/]/.test(String(item.id)) || ['.', '..'].includes(String(item.id))) continue;
            tasks.set(String(item.id), item);
          }
        }
        const detailed = new Set();
        for (const [taskId, item] of tasks) {
          const file = byPath.get(join(dir, 'tasks', taskId, 'ui_messages.json'));
          if (!file) continue;
          detailed.add(taskId);
          // apiConfigName is a user-defined profile, NOT an actual model ID.
          const metadata = { taskId, cwd: item.workspace || item.cwd || null,
            model: item.modelId || item.apiModelId || item.model || UNKNOWN_MODEL };
          candidates.push({ ...file, sessionId: file.path, kind: 'messages', metadata,
            cacheKey: createHash('sha256').update(JSON.stringify(metadata)).digest('base64url') });
        }
        for (const { file, list } of indexes) {
          const fallbackIds = list.filter(item => !detailed.has(String(item?.id))).map(item => String(item?.id));
          if (!fallbackIds.length) continue;
          candidates.push({ ...file, sessionId: file.path, fallbackProject: null, fallbackIds,
            cacheKey: JSON.stringify(fallbackIds) });
        }
      }
      return candidates;
    },

    createFileParser({ candidate = {} } = {}) {
      const records = [];
      const tracker = createTurnTracker();
      let root;
      return {
        onObject(value) { root = value; },
        finish() {
          if (root == null) throw new Error(`${id}: JSON 损坏或尚未写入完成`);
          if (candidate.kind === 'messages') {
            if (!Array.isArray(root)) throw new Error(`${id}: 消息格式不支持`);
            const metadata = candidate.metadata;
            for (const message of root) {
              const ts = message?.ts == null ? NaN : Number(message.ts);
              if (!Number.isFinite(ts) || !Number.isFinite(new Date(ts).getTime())) continue;
              if (message.type === 'ask' || (message.type === 'say' && message.say === 'user_feedback')) tracker.onEvent('user', ts);
              if (message.type !== 'say' || message.say !== 'api_req_started') continue;
              let info;
              try { info = JSON.parse(message.text); } catch { continue; }
              const record = taskToRecord({ ...info, ts, cwd: metadata.cwd, id: `${metadata.taskId}:${ts}` },
                { source: id, fallbackModel: metadata.model });
              if (record) { records.push(record); tracker.onEvent('assistant', ts); }
            }
          } else {
            for (const info of items(root)) {
              if (candidate.fallbackIds && !candidate.fallbackIds.includes(String(info?.id))) continue;
              const record = taskToRecord(info, { source: id, fallbackModel: info?.modelId });
              if (record) { record.billing = { promptTokens: null }; records.push(record); }
            }
          }
          return { records, state: null, session: tracker.snapshot() };
        },
      };
    },
  };
}
