import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { queryDbJson } from './sqlite.js';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'mcode';
export const label = 'MiniMax Code';
export const readMode = 'none';
export const lineFilter = null;
export function dbPath() {
  const override = process.env.MACLAWD_MCODE_DB?.trim();
  if (override) return resolve(override);
  const root = process.env.MCODE_HOME?.trim() || join(homedir(), '.minimax');
  if (!isAbsolute(root)) throw new Error('MCODE_HOME 必须为绝对路径');
  return join(root, 'v2/sqlite/runtime-state.sqlite');
}
export const dataDirs = () => [dbPath()];
export function discover() {
  const path = dbPath();
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  let wal = '';
  try { const s = statSync(path + '-wal'); wal = `${s.ino}:${s.size}:${s.mtimeMs}`; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return [{ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, cacheKey: wal, sessionId: path }];
}
// Checked against vibe-usage fcf1c398 and MiniMax Code 3.0.68's shipped schema.
// Never SELECT raw, record_json or extra_data_json: these contain conversation text.
export function readRecords(path) {
  const columns = ['id', 'session_id', 'model', 'ts', 'input_tokens', 'output_tokens',
    'reasoning_tokens', 'cache_read_tokens', 'cache_write_tokens'];
  for (const [table, required] of [
    ['local_runtime_token_usage', columns],
    ['local_runtime_sessions', ['session_id', 'workspace_dir', 'project_workspace_dir']],
  ]) {
    const present = new Set(queryDbJson(path, `PRAGMA table_info(${table})`).map(row => row.name));
    if (!required.every(column => present.has(column))) throw new Error('MiniMax Code 用量表结构不受支持');
  }
  const rows = queryDbJson(path, `SELECT ${columns.map(c => `t.${c}`).join(',')},
    s.workspace_dir, s.project_workspace_dir FROM local_runtime_token_usage t
    LEFT JOIN local_runtime_sessions s ON s.session_id = t.session_id`);
  return rows.flatMap(row => {
    const stamp = Number(row.ts);
    const ts = stamp < 1e12 ? stamp * 1000 : stamp;
    if (!row.session_id || !Number.isFinite(ts) || ts <= 0) return [];
    const input = toCount(row.input_tokens), cacheRead = toCount(row.cache_read_tokens);
    const write5m = toCount(row.cache_write_tokens), reasoning = toCount(row.reasoning_tokens);
    // MiniMax ledger separates visible output and reasoning; Maclawd output includes both.
    const output = toCount(row.output_tokens) + reasoning;
    if (input + cacheRead + write5m + output === 0) return [];
    return [{ source: id, input, output, cacheRead, write5m, write1h: 0, reasoning,
      model: String(row.model || UNKNOWN_MODEL), ts,
      cwd: row.project_workspace_dir || row.workspace_dir || null,
      project: basename(row.project_workspace_dir || row.workspace_dir || "unknown"),
      messageId: `mcode:${row.id}`, requestId: null, uuid: null, sidechain: false }];
  });
}
export function createFileParser({ candidate }) {
  return { onObject() {}, finish() {
    const records = readRecords(candidate.path);
    return { records, state: null, projectPaths: Object.fromEntries(records.filter(r => r.cwd).map(r => [r.project, r.cwd])) };
  } };
}
