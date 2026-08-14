import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'mimocode';
export const label = 'MiMoCode';

function mimoHome() {
  return process.env.MACLAWD_MIMOCODE_DIR?.trim()
    || join(homedir(), '.local', 'share', 'mimocode');
}

export function dataDirs() {
  return [mimoHome()];
}

function dbPath() {
  return join(mimoHome(), 'mimocode.db');
}

function collectDbs() {
  const path = dbPath();
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  return [{ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }];
}

function rowsToRecords(path) {
  const tables = queryDbJson(path, "SELECT name FROM sqlite_master WHERE type='table'")
    .map((r) => r.name);
  if (!tables.includes('message') || !tables.includes('session')) return [];

  const hasExternalImport = tables.includes('external_import');
  const externalJoin = hasExternalImport
    ? 'LEFT JOIN external_import ON external_import.session_id = message.session_id'
    : '';
  const externalFilter = hasExternalImport
    ? 'WHERE external_import.session_id IS NULL'
    : '';
  const rows = queryDbJson(path, `
    SELECT
      message.session_id AS sessionID,
      message.time_created AS created,
      message.data AS data,
      session.directory AS directory
    FROM message
    JOIN session ON session.id = message.session_id
    ${externalJoin}
    ${externalFilter}
  `);

  const records = [];
  for (const row of rows) {
    let data;
    try {
      data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    } catch {
      continue;
    }
    if (!data || data.role !== 'assistant') continue;

    const tokens = data.tokens;
    if (!data.modelID || !tokens) continue;

    const stamp = data.time?.created ?? row.created;
    const ts = new Date(stamp).getTime();
    if (!Number.isFinite(ts)) continue;

    const input = toCount(tokens.input) + toCount(tokens.cache?.write);
    const output = toCount(tokens.output);
    const cacheRead = toCount(tokens.cache?.read);
    const reasoning = toCount(tokens.reasoning);
    if (input + output + cacheRead === 0) continue;

    const project = row.directory ? basename(row.directory) : null;
    records.push({
      source: id,
      input,
      output: output + reasoning,
      cacheRead,
      write5m: toCount(tokens.cache?.write),
      write1h: 0,
      reasoning,
      model: String(data.modelID).trim() || UNKNOWN_MODEL,
      cwd: row.directory ?? null,
      ts,
      messageId: `mimocode|${row.sessionID}|${ts}|${input}|${output}`,
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
