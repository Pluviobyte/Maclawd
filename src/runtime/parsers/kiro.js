import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'kiro';
export const label = 'Kiro';

/**
 * ⚠️ 未在真实数据上验证（开发机未安装 Kiro）。
 *
 * 只实现 Kiro CLI 的本地 SQLite 用量表（`data.sqlite3`），字段是真实上报的
 * `tokens_prompt` / `tokens_generated`。
 *
 * **有意不实现**：vibe-usage 还有一条从消息正文**估算** token 的路径
 * （模型标记为 `kiro-token-estimate`）。估算值和真实上报值混进同一份统计里，
 * 会让「计费量」这个口径失去意义——用户没法判断哪部分是真的。
 * 若将来要加，必须走独立 source 并在面板上明确区分。
 */
export function dbPath() {
  const override = process.env.MACLAWD_KIRO_DB?.trim();
  if (override) return override;
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3');
  }
  if (platform() === 'win32') {
    const appData = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'kiro-cli', 'data.sqlite3');
  }
  return join(homedir(), '.local', 'share', 'kiro-cli', 'data.sqlite3');
}

export function dataDirs() {
  return [dbPath()];
}

function tableNames(path) {
  try {
    return queryDbJson(path, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
  } catch {
    return [];
  }
}

/** 归一化模型名；Kiro 有时只写 "agent"，那种没有计价意义。 */
function normalizeModel(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.toLowerCase() === 'agent') return UNKNOWN_MODEL;
  return value.replace(/_/g, '-');
}

function rowsToRecords(path) {
  const available = new Set(tableNames(path));
  // 表名跨版本变过，逐个探测；SELECT * 让列名变动不至于让查询直接失败。
  const table = ['conversation_usage', 'usage', 'messages', 'conversations']
    .find((t) => available.has(t));
  if (!table) return [];

  const rows = queryDbJson(path, `SELECT * FROM ${table}`);
  const records = [];

  for (const row of rows) {
    const input = pickCount(row, 'tokens_prompt', 'tokensPrompt', 'input_tokens', 'prompt_tokens');
    const output = pickCount(row, 'tokens_generated', 'tokensGenerated', 'output_tokens', 'completion_tokens');
    const cacheRead = pickCount(row, 'tokens_cache_read', 'cache_read_tokens');
    if (input + output + cacheRead === 0) continue;

    const stamp = row.timestamp ?? row.created_at ?? row.createdAt ?? row.ts;
    const numeric = Number(stamp);
    const ts = Number.isFinite(numeric) && numeric > 0
      ? (numeric > 1e12 ? numeric : numeric * 1000)
      : new Date(stamp).getTime();
    if (!Number.isFinite(ts)) continue;

    records.push({
      source: id,
      input: toCount(input),
      output: toCount(output),
      cacheRead: toCount(cacheRead),
      write5m: 0,
      write1h: 0,
      reasoning: 0,
      model: normalizeModel(row.model),
      cwd: row.cwd ?? row.workspace ?? null,
      ts,
      messageId: row.id != null ? `kiro|${row.id}` : `kiro|${ts}|${input}|${output}`,
      requestId: null,
      uuid: null,
      sidechain: false,
    });
  }
  return records;
}

function dbPaths() {
  const path = dbPath();
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  return [{ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }];
}

const parser = sqliteParser({ id, rowsToRecords, dbPaths });
export const { readMode, discover, createFileParser } = parser;
export const lineFilter = null;
