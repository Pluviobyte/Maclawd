import { statSync } from 'node:fs';
import { join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson } from './sqlite.js';
import { hostRoots } from './vscode-forks.js';
import { loadSettings } from '../settings.js';

export const id = 'cursor';
export const label = 'Cursor';
export const readMode = 'none';
export const lineFilter = null;

/**
 * ⚠️ Cursor 是唯一需要联网的解析器，**默认关闭**。
 *
 * 它在本地只存一个登录 token，用量数据全在云端——这与本项目「纯本地」的不可变
 * 原则 1 冲突。所以它由独立设置项 `cursorCloud` 显式开启，关闭时一个请求都不发。
 *
 * 数据来自 Cursor 自家 dashboard 的 CSV 导出接口，用本机已有的登录态读取。
 * 云端数据会打上固定 hostname `cursor-cloud`，避免多台机器把同一份账号数据重复计入。
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

function pick(row, ...names) {
  for (const name of names) {
    for (const key of Object.keys(row)) {
      if (key.toLowerCase().replace(/[\s_]/g, '') === name) return row[key];
    }
  }
  return undefined;
}

async function fetchRecords(dbPath) {
  const token = readToken(dbPath);
  if (!token) return [];

  let response;
  try {
    response = await fetch(CSV_URL, {
      headers: {
        Cookie: `WorkosCursorSessionToken=${token}`,
        Accept: 'text/csv,*/*;q=0.8',
        Origin: 'https://cursor.com',
        Referer: 'https://cursor.com/dashboard?tab=usage',
      },
      // 单个卡住的主机不能拖住整次扫描
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // 网络问题是瞬时的，不该让这个 source 的历史数据被判为消失
    const error = new Error(`Cursor 云端请求失败: ${err.message}`);
    error.transient = true;
    throw error;
  }
  if (!response.ok) throw new Error(`Cursor 云端返回 HTTP ${response.status}`);

  const rows = parseCsv(await response.text());
  const records = [];
  for (const row of rows) {
    const stamp = pick(row, 'date', 'timestamp', 'createdat', 'time');
    const ts = new Date(stamp).getTime();
    if (!Number.isFinite(ts)) continue;

    const input = toCount(pick(row, 'inputtokens', 'input', 'prompttokens'));
    const output = toCount(pick(row, 'outputtokens', 'output', 'completiontokens'));
    const cacheRead = toCount(pick(row, 'cachereadtokens', 'cacheread'));
    const cacheWrite = toCount(pick(row, 'cachewritetokens', 'cachewrite'));
    if (input + output + cacheRead + cacheWrite === 0) continue;

    records.push({
      source: id,
      input,
      output,
      cacheRead,
      write5m: cacheWrite,
      write1h: 0,
      reasoning: 0,
      model: String(pick(row, 'model') ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
      cwd: null,
      ts,
      // 云端数据每台机器拉到的是同一份，用内容做键让它们自然折叠。
      messageId: `cursor-cloud|${ts}|${pick(row, 'model') ?? ''}|${input}|${output}`,
      requestId: null,
      uuid: null,
      sidechain: false,
    });
  }
  return records;
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
