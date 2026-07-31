import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { statelessParser } from '../parser-kit.js';

export const id = 'pi-coding-agent';
export const label = 'pi';
export const lineFilter = '"usage"';

export function sessionsDir() {
  return process.env.MACLAWD_PI_DIR?.trim()
    || process.env.PI_CODING_AGENT_DIR?.trim()
    || join(homedir(), '.pi', 'agent', 'sessions');
}

export function dataDirs() {
  return [sessionsDir()];
}

/** 目录名是 URL 编码后的 cwd。 */
function projectFromEncodedDir(relative) {
  const first = relative.split(sep)[0] ?? '';
  if (!first) return null;
  let decoded = first;
  try {
    decoded = decodeURIComponent(first);
  } catch {
    // 编码损坏就用原名
  }
  return decoded.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || null;
}

export function discover({ listJsonl }) {
  return listJsonl(sessionsDir()).map(({ path, size, mtimeMs, ino, relative }) => ({
    path,
    size,
    mtimeMs,
    ino,
    sessionId: basename(path, '.jsonl'),
    fallbackProject: projectFromEncodedDir(relative),
  }));
}

/** 字段互不重叠（input/output/cacheRead/cacheWrite 各自独立），不需要减法。 */
export function parseObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const msg = obj.message;
  if (!msg || msg.role !== 'assistant') return null;
  const usage = msg.usage;
  if (!usage || typeof usage !== 'object') return null;

  const stamp = obj.timestamp ?? msg.timestamp;
  const ts = typeof stamp === 'number' ? stamp : new Date(stamp).getTime();
  if (!Number.isFinite(ts)) return null;

  const input = pickCount(usage, 'input', 'inputTokens', 'input_tokens');
  const output = pickCount(usage, 'output', 'outputTokens', 'output_tokens');
  const cacheRead = pickCount(usage, 'cacheRead', 'cache_read', 'cacheReadTokens');
  const cacheWrite = pickCount(usage, 'cacheWrite', 'cache_write', 'cacheWriteTokens');
  const reasoning = pickCount(usage, 'reasoning', 'reasoningTokens');
  if (input + output + cacheRead + cacheWrite === 0) return null;

  return {
    source: id,
    input,
    output: toCount(output),
    cacheRead,
    write5m: cacheWrite,
    write1h: 0,
    reasoning: Math.min(reasoning, toCount(output)),
    model: String(msg.model ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
    ts,
    // pi 的每条记录带 id，直接当去重键。
    messageId: typeof obj.id === 'string' && obj.id ? obj.id : null,
    requestId: null,
    uuid: null,
    sidechain: false,
  };
}

export const createFileParser = statelessParser(parseObject);
