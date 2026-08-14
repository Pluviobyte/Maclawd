import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';

export const id = 'dimagent';
export const label = 'DimAgent';

function dimHome() {
  return process.env.MACLAWD_DIMAGENT_DIR?.trim()
    || join(homedir(), '.dimcode', 'v2');
}

export function dataDirs() {
  return [dimHome()];
}

function dbPath() {
  return join(dimHome(), 'dimcode.sqlite');
}

function collectDbs() {
  const path = dbPath();
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  return [{ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }];
}

const FORKED_LEDGER_ID = /^ledger_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usageSignature(row) {
  return [
    row.runId || '', row.providerId || '', row.modelId || '',
    row.usage || '', row.cost ?? '', row.createdAt || '',
  ].join('\0');
}

function rowsToRecords(path) {
  const tables = queryDbJson(path, "SELECT name FROM sqlite_master WHERE type='table'")
    .map((r) => r.name);
  if (!tables.includes('usage_ledger')) return [];

  const hasSessionsTable = tables.includes('sessions');
  const rows = queryDbJson(path, `
    SELECT
      u.ledgerId, u.runId, u.providerId, u.modelId,
      u.usage, u.cost, u.createdAt
      ${hasSessionsTable ? ', s.cwd' : ''}
    FROM usage_ledger u
    ${hasSessionsTable ? 'LEFT JOIN sessions s ON s.sessionId = u.sessionId' : ''}
  `);

  const originalSignatures = new Set(
    rows.filter((r) => !FORKED_LEDGER_ID.test(r.ledgerId || '')).map(usageSignature),
  );
  const keptOrphanClones = new Set();
  const records = [];

  for (const row of rows) {
    const sig = usageSignature(row);
    if (FORKED_LEDGER_ID.test(row.ledgerId || '')) {
      if (originalSignatures.has(sig) || keptOrphanClones.has(sig)) continue;
      keptOrphanClones.add(sig);
    }

    let usage;
    try {
      usage = typeof row.usage === 'string' ? JSON.parse(row.usage) : row.usage;
    } catch {
      continue;
    }
    if (!usage || typeof usage !== 'object') continue;

    const ts = new Date(row.createdAt).getTime();
    if (!Number.isFinite(ts)) continue;

    const prompt = toCount(usage.promptTokens);
    const cacheRead = Math.min(toCount(usage.cacheReadTokens), prompt);
    const input = Math.max(0, prompt - cacheRead);
    const output = toCount(usage.completionTokens);
    if (input + output + cacheRead === 0) continue;

    const cwd = row.cwd ?? null;
    const project = cwd
      ? String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || null
      : null;

    records.push({
      source: id,
      input,
      output,
      cacheRead,
      write5m: 0,
      write1h: 0,
      reasoning: 0,
      model: String(row.modelId || UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
      cwd,
      ts,
      messageId: `dimagent|${row.ledgerId ?? ''}|${ts}|${input}|${output}`,
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
