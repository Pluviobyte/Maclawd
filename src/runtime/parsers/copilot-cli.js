import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'copilot-cli';
export const label = 'GitHub Copilot CLI';
export const lineFilter = (line) => line.includes('"modelMetrics"') || line.includes('"cwd"');

export function stateDir() {
  return process.env.MACLAWD_COPILOT_DIR?.trim() || join(homedir(), '.copilot', 'session-state');
}

export function dataDirs() {
  return [stateDir()];
}

export function discover({ listJsonl }) {
  return listJsonl(stateDir())
    .filter(({ path }) => path.endsWith('events.jsonl'))
    .map(({ path, size, mtimeMs, ino, relative }) => ({
      path,
      size,
      mtimeMs,
      ino,
      sessionId: relative.split(sep)[0] || path,
      fallbackProject: null,
    }));
}

/**
 * Copilot 的用量只在会话结束事件里一次性给出：
 *   { type: 'session.shutdown', data: { modelMetrics: { <model>: { usage: {...} } } } }
 *
 * `inputTokens` **含** cacheReadTokens，要减掉；cacheWriteTokens 是独立的一档。
 * 一个 shutdown 事件可能带多个模型，所以要逐模型产出多条记录——
 * 这是 createFileParser 而非 statelessParser 的原因。
 */
export function createFileParser({ candidate } = {}) {
  const records = [];
  let cwd = null;
  let ordinal = 0;

  return {
    onObject(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (typeof obj.cwd === 'string' && obj.cwd.trim() && !cwd) cwd = obj.cwd;

      if (obj.type !== 'session.shutdown') return;
      const stamp = obj.timestamp ?? obj.time;
      const ts = typeof stamp === 'number' ? stamp : new Date(stamp).getTime();
      if (!Number.isFinite(ts)) return;

      const metrics = obj.data?.modelMetrics;
      if (!metrics || typeof metrics !== 'object') return;

      for (const [model, entry] of Object.entries(metrics)) {
        const usage = entry?.usage;
        if (!usage || typeof usage !== 'object') continue;

        const totalInput = pickCount(usage, 'inputTokens', 'input_tokens');
        const cacheRead = pickCount(usage, 'cacheReadTokens', 'cache_read_tokens');
        const cacheWrite = pickCount(usage, 'cacheWriteTokens', 'cache_write_tokens');
        const output = pickCount(usage, 'outputTokens', 'output_tokens');
        if (totalInput + cacheRead + cacheWrite + output === 0) continue;

        ordinal++;
        records.push({
          source: id,
          // inputTokens 含缓存读，减掉后三项互斥（不变量 1）
          input: Math.max(0, totalInput - cacheRead),
          output: toCount(output),
          cacheRead: toCount(cacheRead),
          write5m: toCount(cacheWrite),
          write1h: 0,
          reasoning: 0,
          model: String(model).trim() || UNKNOWN_MODEL,
          cwd,
          ts,
          // shutdown 事件天然唯一，用会话 + 模型作键防止重复扫描时重复计入。
          messageId: `${candidate?.sessionId ?? ''}|${ts}|${model}`,
          requestId: null,
          uuid: null,
          sidechain: false,
        });
      }
    },
    finish() {
      for (const record of records) record.cwd = cwd;
      return { records, state: null };
    },
  };
}
