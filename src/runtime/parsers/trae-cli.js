import { homedir, platform } from 'node:os';
import { join, sep } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'trae-cli';
export const label = 'Trae CLI';
export const lineFilter = '"usage.';

/**
 * ⚠️ 未在真实数据上验证（开发机未安装 Trae CLI）。口径依据 vibe-usage 的实现推导。
 *
 * 只覆盖 Trae **CLI** 的遥测，Trae IDE / Trae Work 的对话不在此列。
 */
export function sessionsDir() {
  const override = process.env.MACLAWD_TRAE_CLI_DIR?.trim();
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Caches', 'trae-cli', 'sessions');
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local');
    return join(local, 'trae-cli', 'cache', 'sessions');
  }
  return join(homedir(), '.cache', 'trae-cli', 'sessions');
}

export function dataDirs() {
  return [sessionsDir()];
}

export function discover({ listJsonl }) {
  const base = sessionsDir();
  return listJsonl(base)
    .filter(({ path }) => path.endsWith('traces.jsonl'))
    .map(({ path, size, mtimeMs, ino, relative }) => ({
      path, size, mtimeMs, ino,
      sessionId: relative.split(sep)[0] || path,
      fallbackProject: null,
    }));
}

/** tag 可能是 [{key,value}] 数组，也可能是扁平对象，两种都接。 */
function tagMap(span) {
  const out = {};
  const tags = span?.tags ?? span?.attributes ?? span;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (tag && typeof tag.key === 'string') out[tag.key] = tag.value;
    }
  } else if (tags && typeof tags === 'object') {
    Object.assign(out, tags);
  }
  return out;
}

/**
 * 同一个 span 可能被写多次（trace 的更新语义），所以按 span id 取各字段最大值
 * 而不是累加——累加会把一次调用算成多次。
 */
export function createFileParser({ candidate } = {}) {
  const spans = new Map();

  return {
    onObject(obj) {
      if (!obj || typeof obj !== 'object') return;
      const tags = tagMap(obj);
      const input = toCount(tags['usage.input_tokens']);
      const output = toCount(tags['usage.output_tokens']);
      const cacheRead = toCount(tags['usage.cache_read_tokens']);
      const cacheWrite = toCount(tags['usage.cache_write_tokens']);
      const reasoning = toCount(tags['usage.reasoning_tokens']);
      if (input + output + cacheRead + cacheWrite + reasoning === 0) return;

      const stamp = obj.timestamp ?? obj.startTime ?? obj.start_time ?? tags['start.time'];
      const ts = typeof stamp === 'number'
        ? (stamp > 1e12 ? stamp : stamp * 1000)
        : new Date(stamp).getTime();
      if (!Number.isFinite(ts)) return;

      const key = obj.spanId ?? obj.span_id ?? obj.id ?? `${ts}`;
      const prev = spans.get(key);
      const merged = {
        input: Math.max(prev?.input ?? 0, input),
        output: Math.max(prev?.output ?? 0, output),
        cacheRead: Math.max(prev?.cacheRead ?? 0, cacheRead),
        cacheWrite: Math.max(prev?.cacheWrite ?? 0, cacheWrite),
        reasoning: Math.max(prev?.reasoning ?? 0, reasoning),
        ts: prev?.ts ?? ts,
        model: tags['llm.model'] ?? tags['model'] ?? prev?.model ?? null,
        cwd: tags['cwd'] ?? obj.cwd ?? prev?.cwd ?? null,
      };
      spans.set(key, merged);
    },
    finish() {
      const records = [];
      for (const [key, span] of spans) {
        records.push({
          source: id,
          input: span.input,
          output: span.output,
          cacheRead: span.cacheRead,
          write5m: span.cacheWrite,
          write1h: 0,
          reasoning: Math.min(span.reasoning, span.output),
          model: String(span.model ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
          cwd: span.cwd,
          ts: span.ts,
          messageId: `${candidate?.sessionId ?? ''}|${key}`,
          requestId: null,
          uuid: null,
          sidechain: false,
        });
      }
      return { records, state: null };
    },
  };
}
