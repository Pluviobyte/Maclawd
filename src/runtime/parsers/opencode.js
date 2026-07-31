import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'opencode';
export const label = 'OpenCode';

/** ⚠️ 未在真实数据上验证（开发机未安装 OpenCode）。口径依据 vibe-usage 推导。 */
export function dbPath() {
  return process.env.MACLAWD_OPENCODE_DB?.trim()
    || join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

export function dataDirs() {
  return [dbPath()];
}

function rowsToRecords(path) {
  // json_extract 比按列名取更稳——OpenCode 的 message 表把内容整体存成 JSON。
  const rows = queryDbJson(path, `SELECT
      id,
      json_extract(data, '$.role')        AS role,
      json_extract(data, '$.time.created') AS created,
      json_extract(data, '$.modelID')     AS modelID,
      json_extract(data, '$.tokens')      AS tokens,
      json_extract(data, '$.path.root')   AS rootPath
    FROM message`);

  const records = [];
  for (const row of rows) {
    if (row.role !== 'assistant') continue;
    let tokens;
    try {
      tokens = typeof row.tokens === 'string' ? JSON.parse(row.tokens) : row.tokens;
    } catch {
      continue;
    }
    if (!tokens || typeof tokens !== 'object') continue;

    const stamp = Number(row.created);
    // created 可能是秒或毫秒
    const ts = Number.isFinite(stamp) ? (stamp > 1e12 ? stamp : stamp * 1000) : NaN;
    if (!Number.isFinite(ts)) continue;

    // 各字段互不重叠，不需要减法。
    const input = toCount(tokens.input);
    const output = toCount(tokens.output);
    const cacheRead = toCount(tokens.cache?.read);
    const cacheWrite = toCount(tokens.cache?.write);
    const reasoning = toCount(tokens.reasoning);
    if (input + output + cacheRead + cacheWrite === 0) continue;

    records.push({
      source: id,
      input,
      output,
      cacheRead,
      write5m: cacheWrite,
      write1h: 0,
      reasoning: Math.min(reasoning, output),
      model: String(row.modelID ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
      cwd: row.rootPath ?? null,
      ts,
      messageId: row.id ? String(row.id) : null,
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
