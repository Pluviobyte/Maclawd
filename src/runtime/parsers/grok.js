import { homedir } from 'node:os';
import { join, sep, dirname, basename } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { readLines } from '../read-lines.js';
import { timestamp } from './local-data.js';
import { resolveInclusiveInput, toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'grok';
export const label = 'Grok Build';
export const lineFilter = '"turn_completed"';

export function grokHome() {
  return process.env.MACLAWD_GROK_DIR?.trim()
    || process.env.GROK_HOME?.trim()
    || join(homedir(), '.grok');
}

export function dataDirs() {
  return [join(grokHome(), 'sessions')];
}

/**
 * 会话目录名是 URL 编码后的 cwd，例如
 *   %2FUsers%2Frain%2FDesktop%2FHarness%E5%AD%A6%E4%B9%A0
 * 解码后取末段目录名即项目。
 */
function projectFromEncodedDir(relative) {
  const first = relative.split(sep)[0] ?? '';
  if (!first) return null;
  let decoded = first;
  try {
    decoded = decodeURIComponent(first);
  } catch {
    // 编码损坏时退回原始目录名，好过丢掉项目归属。
  }
  const trimmed = decoded.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) || null;
}

export function discover({ listJsonl }) {
  const base = join(grokHome(), 'sessions');
  const groups = new Map();
  for (const file of listJsonl(base, { extensions: ['.json', '.jsonl'] })) {
    if (!['updates.jsonl', 'usage.json', 'summary.json', 'signals.json'].includes(basename(file.path))) continue;
    const dir = dirname(file.path);
    if (!groups.has(dir)) groups.set(dir, {});
    groups.get(dir)[basename(file.path)] = file;
  }
  const parents = new Map();
  for (const [dir, files] of groups) {
    const summary = readOptional(join(dir, 'summary.json'));
    parents.set(summary?.info?.id || basename(dir), summary?.parent_session_id || null);
  }
  return [...groups].flatMap(([dir, files]) => {
    const anchor = files['updates.jsonl'] || files['usage.json'] || files['signals.json'];
    if (!anchor) return [];
    const summary = readOptional(join(dir, 'summary.json'));
    let lineage = summary?.info?.id || basename(dir);
    const seen = new Set();
    while (parents.get(lineage)) {
      if (seen.has(lineage)) throw new Error('Grok 会话继承关系循环');
      seen.add(lineage); lineage = parents.get(lineage);
    }
    return [{ ...anchor, readMode: 'none', kind: 'session', dir, lineage,
      sessionId: dir, fallbackProject: projectFromEncodedDir(anchor.relative),
      cacheKey: JSON.stringify([lineage, ...Object.entries(files).map(([name, f]) => [name, f.ino, f.size, f.mtimeMs])]) }];
  });
}

function readOptional(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function toRecord({ usage, model, ts, sessionId, promptId, cwd }) {
  const resolved = resolveInclusiveInput({
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cachedReadTokens,
    cacheWrite: 0,
    total: usage.totalTokens,
  });
  const output = toCount(usage.outputTokens);
  if (resolved.input + output + resolved.cacheRead === 0) return null;

  return {
    source: id,
    input: resolved.input,
    output,
    cacheRead: resolved.cacheRead,
    write5m: 0,
    write1h: 0,
    reasoning: Math.min(toCount(usage.reasoningTokens), output),
    model: model || UNKNOWN_MODEL,
    cwd,
    ts,
    // 一个 turn 可能包含多次模型调用，按模型拆开后要把模型名放进键里，
    // 否则同一个 prompt 的多个模型会互相吃掉。
    messageId: `${sessionId ?? ''}|${promptId ?? ''}|${model ?? ''}`,
    requestId: null,
    uuid: null,
    sidechain: false,
  };
}

/**
 * turn_completed 事件携带整个 turn 的合计用量，以及按模型拆分的 modelUsage。
 *
 * 实测 ~/.grok/sessions/**\/updates.jsonl：
 *   totalTokens(180871) == inputTokens(178992) + outputTokens(1879)
 * → input **含缓存**（不变量 1，减掉 cachedReadTokens）；reasoningTokens ⊂ output。
 * timestamp 是 epoch **秒**。
 *
 * 有 modelUsage 时按模型逐条产出，没有时退回合计——这样模型维度不会全部落到 unknown。
 */
function legacyParser({ candidate } = {}) {
  const records = [];
  let sessionCwd = null;

  return {
    onObject(obj) {
      const update = obj?.params?.update;
      if (!update || update.sessionUpdate !== 'turn_completed') return;
      const usage = update.usage;
      if (!usage || typeof usage !== 'object') return;

      const ts = timestamp(obj.timestamp);
      if (ts === null) return;

      const sessionId = candidate?.lineage || obj.params?.sessionId || candidate?.sessionId;
      const promptId = update.prompt_id ?? ts;

      const modelUsage = usage.modelUsage;
      if (modelUsage && typeof modelUsage === 'object' && Object.keys(modelUsage).length > 0) {
        for (const [model, perModel] of Object.entries(modelUsage)) {
          if (!perModel || typeof perModel !== 'object') continue;
          const record = toRecord({
            usage: perModel, model, ts, sessionId, promptId, cwd: sessionCwd,
          });
          if (record) records.push(record);
        }
        return;
      }

      const record = toRecord({
        usage, model: candidate?.fallbackModel, ts, sessionId, promptId, cwd: sessionCwd,
      });
      if (record) records.push(record);
    },

    finish() {
      // Grok 的项目来自目录名，由 scan.js 的 fallbackProject 兜住。
      void candidate;
      return { records, state: null };
    },
  };
}

/** Official Grok 4247f661: endedAt/modelUsage and inclusive input+output total.
 * Ledger snapshots include inherited turns; lineage + original turn time keeps
 * fork copies from becoming new consumption. Never add session totals to turns.
 */
export function createFileParser({ candidate } = {}) {
  if (candidate?.kind !== 'session') return legacyParser({ candidate });
  return { onObject() {}, async finish() {
    const summary = readOptional(join(candidate.dir, 'summary.json')) || {};
    const legacy = legacyParser({ candidate: { ...candidate, fallbackModel: summary.current_model_id } });
    const times = [];
    const updates = join(candidate.dir, 'updates.jsonl');
    try {
      await readLines(updates, 0, statSync(updates).size, line => {
        if (!line.includes('turn_completed')) return;
        const obj = JSON.parse(line);
        if (obj?.params?.update?.sessionUpdate !== 'turn_completed') return;
        times.push(timestamp(obj.timestamp)); legacy.onObject(obj);
      });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const ledger = readOptional(join(candidate.dir, 'usage.json'));
    let records = legacy.finish().records;
    if (ledger) {
      if (!Array.isArray(ledger.turns) || ledger.usageIsIncomplete || ledger.session?.usageIsIncomplete) {
        throw new Error('Grok 用量账本格式不支持或尚未完整');
      }
      records = [];
      for (const [index, turn] of ledger.turns.entries()) {
        if (turn.usageIsIncomplete) throw new Error('Grok 轮次用量尚未完整');
        const ts = timestamp(turn.endedAt) ?? times[index];
        const models = turn.modelUsage && Object.keys(turn.modelUsage).length
          ? Object.entries(turn.modelUsage) : [[turn.primaryModelId || summary.current_model_id, turn]];
        for (const [model, usage] of models) {
          if (usage.usageIsIncomplete) throw new Error('Grok 模型用量尚未完整');
          if (ts == null && toCount(usage.inputTokens) + toCount(usage.outputTokens) > 0) {
            throw new Error('Grok 用量缺少轮次时间');
          }
          const record = toRecord({ usage, model, ts, sessionId: candidate.lineage,
            promptId: `${turn.turnNumber ?? index + 1}|${ts}`, cwd: summary.info?.cwd || null });
          if (record) { record.billing = { promptTokens: null }; records.push(record); }
        }
      }
      if (!ledger.turns.length && toCount(ledger.session?.inputTokens) + toCount(ledger.session?.outputTokens) > 0) {
        throw new Error('Grok 仅有含继承历史的会话总量，缺少可归属的轮次');
      }
    }
    const signals = readOptional(join(candidate.dir, 'signals.json'));
    if (!records.length && (times.length || toCount(signals?.turnCount))) {
      throw new Error('Grok 有已完成轮次但未读到用量，可能是日志格式变化');
    }
    return { records, state: null };
  } };
}
