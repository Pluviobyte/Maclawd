import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
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
export const cacheTtlMs = 10 * 60 * 1000;

/**
 * ⚠️ Cursor 是唯一需要联网的解析器，**默认关闭**。
 *
 * 它在本地只存一个登录 token，用量数据全在云端——这与本项目「纯本地」的不可变
 * 原则 1 冲突。所以它由独立设置项 `cursorCloud` 显式开启，关闭时一个请求都不发。
 *
 * 数据来自 Cursor 自家 dashboard 的 CSV 导出接口，用本机已有的登录态读取。
 * 记录使用云端行内容的稳定指纹，避免多个 Cursor 配置根重复计入同一份账号数据。
 *
 * ⚠️ 未在真实数据上验证（开发机未安装 Cursor）。
 */
const CSV_URL = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';
const TOKEN_KEY = 'cursorAuth/accessToken';

export function enabled() {
  return loadSettings().cursorCloud === true;
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
  return stateDbPaths().map((p) => p.path);
}

export function discover() {
  if (!enabled()) return [];
  return stateDbPaths().map(({ path, size, mtimeMs, ino }) => ({
    path, size, mtimeMs, ino, sessionId: path, fallbackProject: null,
  }));
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
      if (!enabled()) return { records: [], state: null };
      return { records: await fetchRecords(candidate.path), state: null };
    },
  };
}
