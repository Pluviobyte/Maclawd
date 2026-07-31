import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'hermes';
export const label = 'Hermes';

/**
 * ⚠️ 未在真实数据上验证（开发机的 ~/.hermes 没有 state.db）。
 *
 * Hermes 支持多 profile：`~/.hermes/state.db` 与 `~/.hermes/profiles/<name>/state.db`。
 * 表结构跨版本变动过（0.19 迁移新增了 session_model_usage），所以这里
 * **不写死列名**——先探测有哪些表和列，再按别名池取值。硬编码列名的查询
 * 在版本不匹配时会直接抛错，等于整个工具的数据都读不到。
 */
export function hermesHome() {
  return process.env.MACLAWD_HERMES_DIR?.trim()
    || process.env.HERMES_HOME?.trim()
    || join(homedir(), '.hermes');
}

export function dataDirs() {
  return [hermesHome()];
}

function collectDbs() {
  const home = hermesHome();
  const paths = [];
  const add = (path, profile) => {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    paths.push({ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, project: profile });
  };
  add(join(home, 'state.db'), null);
  try {
    const profiles = join(home, 'profiles');
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (entry.isDirectory()) add(join(profiles, entry.name, 'state.db'), entry.name);
    }
  } catch {
    // 没有 profiles 目录
  }
  return paths;
}

/** 优先用明细表，回落到会话汇总表。 */
const CANDIDATE_TABLES = [
  'session_model_usage',
  'session_model_usage_v21',
  'sessions',
];

function tableNames(path) {
  try {
    return queryDbJson(path, "SELECT name FROM sqlite_master WHERE type='table'")
      .map((r) => r.name);
  } catch {
    return [];
  }
}

function rowsToRecords(path) {
  const available = new Set(tableNames(path));
  const table = CANDIDATE_TABLES.find((t) => available.has(t));
  if (!table) return [];

  // SELECT * 让列名变动不至于让查询失败，字段挑选交给 JS。
  const rows = queryDbJson(path, `SELECT * FROM ${table}`);
  const records = [];

  for (const row of rows) {
    const input = pickCount(row, 'input_tokens', 'inputTokens', 'prompt_tokens');
    const output = pickCount(row, 'output_tokens', 'outputTokens', 'completion_tokens');
    const cacheRead = pickCount(row, 'cache_read_tokens', 'cacheReadTokens', 'cache_read_input_tokens');
    const cacheWrite = pickCount(row, 'cache_write_tokens', 'cacheWriteTokens', 'cache_creation_input_tokens');
    const reasoning = pickCount(row, 'reasoning_tokens', 'reasoningTokens');
    if (input + output + cacheRead + cacheWrite === 0) continue;

    const stamp = row.created_at ?? row.createdAt ?? row.updated_at ?? row.ts ?? row.timestamp;
    const numeric = Number(stamp);
    const ts = Number.isFinite(numeric) && numeric > 0
      ? (numeric > 1e12 ? numeric : numeric * 1000)
      : new Date(stamp).getTime();
    if (!Number.isFinite(ts)) continue;

    records.push({
      source: id,
      input,
      // Hermes 各字段独立，reasoning 不含在 output 里；为满足不变量 2 加进去。
      output: toCount(output) + toCount(reasoning),
      cacheRead,
      write5m: cacheWrite,
      write1h: 0,
      reasoning,
      model: String(row.model ?? row.model_id ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
      cwd: row.cwd ?? row.workspace ?? null,
      ts,
      messageId: row.id != null
        ? `${basename(path)}|${table}|${row.id}`
        : `${basename(path)}|${table}|${ts}|${input}|${output}`,
      requestId: null,
      uuid: null,
      sidechain: false,
    });
  }
  return records;
}

const parser = sqliteParser({ id, rowsToRecords, dbPaths: collectDbs });
export const { readMode, discover, createFileParser } = parser;
export const lineFilter = null;
