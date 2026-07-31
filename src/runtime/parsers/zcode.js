import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveInclusiveInput, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'zcode';
export const label = 'ZCode';

/** ⚠️ 未在真实数据上验证（开发机未安装 ZCode）。口径依据 vibe-usage 推导。 */
export function dbPath() {
  return process.env.MACLAWD_ZCODE_DB?.trim()
    || join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
}

export function dataDirs() {
  return [dbPath()];
}

function rowsToRecords(path) {
  const rows = queryDbJson(path, `SELECT
      m.id                                  AS id,
      json_extract(m.data, '$.role')        AS role,
      json_extract(m.data, '$.time.created') AS created,
      json_extract(m.data, '$.modelID')     AS modelID,
      json_extract(m.data, '$.tokens')      AS tokens,
      json_extract(m.data, '$.path.root')   AS pathRoot,
      json_extract(m.data, '$.path.cwd')    AS pathCwd
    FROM message m`);

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
    const ts = Number.isFinite(stamp) ? (stamp > 1e12 ? stamp : stamp * 1000) : NaN;
    if (!Number.isFinite(ts)) continue;

    const rawInput = toCount(tokens.input);
    const output = toCount(tokens.output);
    const cacheRead = toCount(tokens.cache?.read ?? tokens.cached);
    const cacheWrite = toCount(tokens.cache?.write);
    const reasoning = toCount(tokens.reasoning);

    // ZCode 的 input 含缓存（与 Gemini 同一族口径），减掉后互斥。
    const resolved = resolveInclusiveInput({
      input: rawInput,
      output,
      cacheRead,
      cacheWrite,
      total: rawInput + output,
    });
    if (resolved.input + output + resolved.cacheRead + resolved.cacheWrite === 0) continue;

    records.push({
      source: id,
      input: resolved.input,
      output,
      cacheRead: resolved.cacheRead,
      write5m: resolved.cacheWrite,
      write1h: 0,
      reasoning: Math.min(reasoning, output),
      model: String(row.modelID ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
      cwd: row.pathCwd ?? row.pathRoot ?? null,
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
