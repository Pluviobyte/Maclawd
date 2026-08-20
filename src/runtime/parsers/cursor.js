import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson } from './sqlite.js';
import { hostRoots } from './vscode-forks.js';
import { loadSettings } from '../settings.js';
import { cursorDashboardHeaders, fetchCursorWithAuth } from '../cursor-auth.js';

export const id = 'cursor';
export const label = 'Cursor';
export const readMode = 'none';
export const lineFilter = null;
// 云端 CSV 会在本地 state.vscdb 不变时继续增长，不能只按文件签名缓存。
export function cacheTtlMs(candidate) {
  return candidate?.kind === 'cloud-db' ? 10 * 60 * 1000 : null;
}

/**
 * Cursor 有两条互相独立的数据通道：
 *
 * 1. 本地 Cursor hook 执行日志。stop 事件包含精确的 input/output/cache token，
 *    默认读取、完全离线；没有配置任何 Cursor/Claude 兼容 hook 时不会生成这类日志。
 * 2. dashboard CSV。由 `cursorCloud` 显式切换启用，用于需要完整历史的场景。
 *
 * 云端 CSV 没有 generation id，不能与本地事件逐条安全去重。因此两条通道是互斥
 * 的：默认只读本地；打开 `cursorCloud` 后改读云端，而不是把两份数据相加。
 */
const CSV_URL = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';
const TOKEN_KEY = 'cursorAuth/accessToken';

export function enabled() {
  return loadSettings().cursorCloud === true;
}

export function cursorLogsDir() {
  return process.env.MACLAWD_CURSOR_LOG_DIR?.trim()
    || join(homedir(), 'Library', 'Application Support', 'Cursor', 'logs');
}

function stateDbPaths() {
  const paths = [];
  for (const root of hostRoots()) {
    if (!/Cursor$/.test(root)) continue;
    const db = join(root, 'User', 'globalStorage', 'state.vscdb');
    try {
      const stat = statSync(db);
      paths.push({ path: db, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino });
    } catch {
      // 没装 Cursor
    }
  }
  return paths;
}

export function dataDirs() {
  return [cursorLogsDir(), ...stateDbPaths().map((p) => p.path)];
}

export function discover({ listJsonl }) {
  if (enabled()) {
    return stateDbPaths().map(({ path, size, mtimeMs, ino }) => ({
      path, size, mtimeMs, ino, sessionId: 'cursor-cloud-account', fallbackProject: null,
      kind: 'cloud-db',
    }));
  }
  const local = listJsonl(cursorLogsDir(), { extensions: ['.log'] })
    .filter(({ path }) => basename(path).startsWith('cursor.hooks.'))
    .map(({ path, size, mtimeMs, ino }) => ({
      path, size, mtimeMs, ino, sessionId: path, fallbackProject: null,
      kind: 'local-hook-log',
    }));
  return local;
}

function localRecord(payload, ts, fallbackKey) {
  if (payload?.hook_event_name !== 'stop') return null;
  const rawInput = toCount(payload.input_tokens);
  const output = toCount(payload.output_tokens);
  const cacheRead = toCount(payload.cache_read_tokens);
  const cacheWrite = toCount(payload.cache_write_tokens);
  // 真机日志关系：input_tokens == 非缓存输入 + cache read + cache write。
  // 例如 106447 == 4 + 52462 + 53981；统计合同要求四项互斥。
  const input = Math.max(0, rawInput - cacheRead - cacheWrite);
  if (input + output + cacheRead + cacheWrite === 0) return null;

  const generation = typeof payload.generation_id === 'string'
    && payload.generation_id.trim() ? payload.generation_id.trim() : fallbackKey;
  const rawModel = String(payload.model_id ?? payload.model ?? '').trim();
  const model = rawModel && rawModel !== 'default' ? rawModel : UNKNOWN_MODEL;
  const cwd = Array.isArray(payload.workspace_roots)
    && typeof payload.workspace_roots[0] === 'string'
    ? payload.workspace_roots[0] : null;

  return {
    source: id,
    input,
    output,
    cacheRead,
    // Cursor 只给一个 cache_write_tokens 总数，没有 5m/1h TTL 维度。
    write5m: cacheWrite,
    write1h: 0,
    reasoning: 0,
    model,
    cwd,
    ts,
    messageId: `cursor-local|${generation}`,
    requestId: generation,
    uuid: null,
    sidechain: false,
  };
}

/**
 * Cursor 的 hook 输出日志不是 JSONL，而是带分隔线的文本块。只认 stop 请求后紧邻的
 * INPUT JSON；命令输出、prompt、transcript 等其他内容一律不解析。
 */
export function parseCursorHookLog(text) {
  const marker = /\[([^\]]+)] Hook step requested: stop\s*$/gm;
  const records = [];
  const seen = new Set();
  let match;
  while ((match = marker.exec(text)) !== null) {
    const ts = new Date(match[1]).getTime();
    if (!Number.isFinite(ts)) continue;

    const nextStop = text.indexOf('Hook step requested:', marker.lastIndex);
    const boundary = nextStop === -1 ? text.length : nextStop;
    const inputAt = text.indexOf('\nINPUT:\n', marker.lastIndex);
    if (inputAt === -1 || inputAt >= boundary) continue;
    const outputAt = text.indexOf('\nOUTPUT:', inputAt + 8);
    if (outputAt === -1 || outputAt >= boundary) continue;
    const jsonStart = text.indexOf('{', inputAt + 8);
    const jsonEnd = text.lastIndexOf('}', outputAt);
    if (jsonStart === -1 || jsonEnd < jsonStart) continue;

    let payload;
    try {
      payload = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      continue;
    }
    const fallbackKey = createHash('sha256')
      .update(text.slice(match.index, outputAt)).digest('hex').slice(0, 24);
    const record = localRecord(payload, ts, fallbackKey);
    if (!record || seen.has(record.messageId)) continue;
    seen.add(record.messageId);
    records.push(record);
  }
  return records;
}

function readToken(dbPath) {
  const rows = queryDbJson(
    dbPath,
    `SELECT value FROM ItemTable WHERE key = '${TOKEN_KEY}' LIMIT 1`,
  );
  const raw = rows?.[0]?.value;
  if (typeof raw !== 'string' || !raw) return null;
  // 值有时是裸 token，有时是被 JSON 引号包住的字符串
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}

/** 极简 CSV 解析：支持带引号字段与转义引号。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.length >= header.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function normalizedHeader(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pick(row, ...names) {
  for (const name of names) {
    for (const key of Object.keys(row)) {
      if (normalizedHeader(key) === normalizedHeader(name)) return row[key];
    }
  }
  return undefined;
}

function cursorCount(value) {
  return toCount(typeof value === 'string' ? value.replace(/,/g, '') : value);
}

export function parseCursorUsageCsv(text) {
  const rows = parseCsv(text);
  const records = [];
  const occurrences = new Map();
  for (const row of rows) {
    const stamp = pick(row, 'date', 'timestamp', 'createdat', 'time');
    const date = String(stamp ?? '').trim();
    const ts = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? Date.parse(`${date}T00:00:00Z`)
      : new Date(date).getTime();
    if (!Number.isFinite(ts)) continue;

    const inputWithCacheWrite = cursorCount(pick(row, 'Input (w/ Cache Write)'));
    const inputWithoutCacheWrite = cursorCount(pick(row, 'Input (w/o Cache Write)'));
    const legacyInput = cursorCount(pick(row, 'inputtokens', 'input', 'prompttokens'));
    const input = inputWithCacheWrite + inputWithoutCacheWrite || legacyInput;
    const output = cursorCount(pick(row, 'outputtokens', 'output', 'completiontokens'));
    const cacheRead = cursorCount(pick(row, 'Cache Read', 'cachereadtokens', 'cacheread'));
    if (input + output + cacheRead === 0) continue;

    const model = String(pick(row, 'model') ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL;
    const fingerprint = createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 24);
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);

    records.push({
      source: id,
      input,
      output,
      cacheRead,
      // Cursor 的这一列是“发生 cache write 时的 input”，不是 cache write token 数。
      write5m: 0,
      write1h: 0,
      reasoning: 0,
      model,
      cwd: null,
      ts,
      // 指纹跨快照排序稳定；出现次序保留数值完全相同的合法请求。
      messageId: `cursor-cloud|${fingerprint}|${occurrence}`,
      requestId: null,
      uuid: null,
      sidechain: false,
    });
  }
  return records;
}

async function fetchRecords(dbPath) {
  const token = readToken(dbPath);
  if (!token) return [];

  let response;
  try {
    response = await fetchCursorWithAuth(CSV_URL, {
      token,
      headers: cursorDashboardHeaders('text/csv,*/*;q=0.8'),
      // 单个卡住的主机不能拖住整次扫描
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err?.code === 'EAUTH') throw err;
    // 网络问题是瞬时的，不该让这个 source 的历史数据被判为消失
    const error = new Error(`Cursor 云端请求失败: ${err.message}`);
    error.transient = true;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Cursor 云端返回 HTTP ${response.status}`);
    error.transient = response.status === 429 || response.status >= 500;
    throw error;
  }

  return parseCursorUsageCsv(await response.text());
}

export function createFileParser({ candidate } = {}) {
  return {
    onObject() { /* 不走行解析 */ },
    async finish() {
      if (candidate?.kind === 'local-hook-log') {
        return { records: parseCursorHookLog(readFileSync(candidate.path, 'utf8')), state: null };
      }
      if (!enabled() || candidate?.kind !== 'cloud-db') return { records: [], state: null };
      return { records: await fetchRecords(candidate.path), state: null };
    },
  };
}
