import { homedir } from 'node:os';
import { join, sep } from 'node:path';
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
  return listJsonl(base)
    .filter(({ path }) => path.endsWith('updates.jsonl'))
    .map(({ path, size, mtimeMs, ino, relative }) => ({
      path,
      size,
      mtimeMs,
      ino,
      sessionId: path,
      fallbackProject: projectFromEncodedDir(relative),
    }));
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
export function createFileParser({ candidate } = {}) {
  const records = [];
  let sessionCwd = null;

  return {
    onObject(obj) {
      const update = obj?.params?.update;
      if (!update || update.sessionUpdate !== 'turn_completed') return;
      const usage = update.usage;
      if (!usage || typeof usage !== 'object') return;

      const rawTs = obj.timestamp;
      if (typeof rawTs !== 'number' || !Number.isFinite(rawTs)) return;
      // 10^10 秒 ≈ 2286 年，小于它就是秒。
      const ts = rawTs > 10_000_000_000 ? rawTs : rawTs * 1000;

      const sessionId = obj.params?.sessionId ?? null;
      const promptId = update.prompt_id ?? null;

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
        usage, model: null, ts, sessionId, promptId, cwd: sessionCwd,
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
