import { join, resolve, sep } from 'node:path';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { applicationData, databaseCandidate } from './local-data.js';
import { queryDbJson } from './sqlite.js';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { sessionDirs as codexDirs } from './codex.js';
import { piSessionDirs } from './pi-roots.js';

const canonical = path => { try { return realpathSync(path); } catch { return resolve(path); } };

export function localDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number), date = new Date(y, m - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date.getTime() : null;
}
// Official Cindy 40f087c9 / v0.1.82: this ledger already contains turn deltas.
export function cindyParser({ id, label, name, env }) {
  const root = () => process.env[env]?.trim() || applicationData(name);
  return {
    id, label, readMode: 'none', dataDirs: () => [root()],
    discover() {
      let entries;
      try { entries = readdirSync(root(), { withFileTypes: true }); }
      catch (e) { if (e.code === 'ENOENT') return []; throw e; }
      const inside = path => existsSync(path) && canonical(path).startsWith(canonical(root()) + sep);
      const excluded = [ ...(codexDirs().some(inside) ? ['codex'] : []), ...(piSessionDirs().some(inside) ? ['pi'] : []) ];
      return entries.filter(file => file.isFile() && /^cindy-.+\.db$/.test(file.name))
        .map(file => databaseCandidate(join(root(), file.name))).filter(Boolean)
        .map(file => ({ ...file, excluded, cacheKey: file.cacheKey + JSON.stringify(excluded) }));
    },
    createFileParser({ candidate }) {
      return { onObject() {}, finish() {
        // Claude is already recorded in ~/.claude. Never add that ledger again.
        // Do not scan Cindy's private codex-home alongside this daily fallback.
        const rows = queryDbJson(candidate.path, `SELECT day,agent_kind,model,
          SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,
          SUM(cache_read_tokens) AS cache_read_tokens,SUM(cache_create_tokens) AS cache_create_tokens
          FROM daily_model_usage WHERE agent_kind IN ('codex','pi') GROUP BY day,agent_kind,model`);
        const records = rows.flatMap(row => {
          if (candidate.excluded?.includes(row.agent_kind)) return [];
          const ts = localDay(row.day);
          if (ts === null) throw new Error('Cindy 账本日期无效');
          const input = toCount(row.input_tokens), output = toCount(row.output_tokens);
          const cacheRead = toCount(row.cache_read_tokens), write5m = toCount(row.cache_create_tokens);
          if (!input && !output && !cacheRead && !write5m) return [];
          return [{ source: id, input, output, cacheRead, write5m, write1h: 0, reasoning: 0,
            model: String(row.model || UNKNOWN_MODEL), ts,
            billing: { promptTokens: null, resolution: 'day', ...(write5m ? { unknownWriteTTL: true } : {}) },
            messageId: JSON.stringify([candidate.path, row.day, row.agent_kind, row.model]),
            requestId: null, uuid: null, sidechain: false }];
        });
        return { records, state: null };
      } };
    },
  };
}
const parser = cindyParser({ id: 'cindy', label: 'Cindy（国内版）', name: 'Cindy', env: 'MACLAWD_CINDY_DIR' });
export const { id, label, readMode, dataDirs, discover, createFileParser } = parser;
