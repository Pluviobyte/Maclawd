import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'alma';
export const label = 'Alma';

function almaHome() {
  if (process.env.MACLAWD_ALMA_DIR?.trim()) return process.env.MACLAWD_ALMA_DIR.trim();
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'alma');
  }
  return join(process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share'), 'alma');
}

export function dataDirs() {
  return [almaHome()];
}

function dbPath() {
  return join(almaHome(), 'chat_threads.db');
}

function collectDbs() {
  const path = dbPath();
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  return [{ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }];
}

const SQL = `
  SELECT
    usage_records.model AS model,
    usage_records.timestamp AS timestamp,
    usage_records.input_tokens AS inputTokens,
    usage_records.output_tokens AS outputTokens,
    usage_records.cached_input_tokens AS cachedInputTokens,
    usage_records.reasoning_tokens AS reasoningTokens,
    usage_records.cache_write_input_tokens AS cacheWriteTokens,
    workspaces.name AS workspaceName
  FROM usage_records
  LEFT JOIN chat_threads ON chat_threads.id = usage_records.thread_id
  LEFT JOIN workspaces ON workspaces.id = chat_threads.workspace_id
`;

function rowsToRecords(path) {
  let rows;
  try {
    rows = queryDbJson(path, SQL);
  } catch (err) {
    if (/no such (table|column)/i.test(err?.message)) return [];
    throw err;
  }

  const records = [];
  for (const row of rows) {
    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;

    const cacheWrite = toCount(row.cacheWriteTokens);
    const input = toCount(row.inputTokens) + cacheWrite;
    const output = toCount(row.outputTokens);
    const cacheRead = toCount(row.cachedInputTokens);
    const reasoning = toCount(row.reasoningTokens);
    if (input + output + cacheRead === 0) continue;

    const workspace = typeof row.workspaceName === 'string'
      ? basename(row.workspaceName.trim().replace(/[\\/]+$/, '')) || null
      : null;

    records.push({
      source: id,
      input,
      output: output + reasoning,
      cacheRead,
      write5m: cacheWrite,
      write1h: 0,
      reasoning,
      model: String(row.model || UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
      cwd: null,
      ts,
      messageId: `alma|${ts}|${row.model}|${input}|${output}`,
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
