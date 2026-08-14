import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { statelessParser } from '../parser-kit.js';

export const id = 'craft-agent';
export const label = 'CraftAgent';
export const lineFilter = '"usage"';

/**
 * CraftAgent 把 `.pi-sessions/` 目录嵌在各个 craft workspace 下面。
 * 与 pi 的区别只在目录结构；JSONL 格式完全同构。
 */
function workspacesDir() {
  return process.env.MACLAWD_CRAFT_DIR?.trim()
    || join(homedir(), '.craft', 'workspaces');
}

export function dataDirs() {
  return [workspacesDir()];
}

function projectFromPath(relative) {
  const parts = relative.split(sep);
  const sessionsIdx = parts.indexOf('sessions');
  if (sessionsIdx >= 0 && parts[sessionsIdx + 1]) {
    return parts[sessionsIdx + 1];
  }
  return parts[0] || null;
}

export function discover({ listJsonl }) {
  return listJsonl(workspacesDir()).map(({ path, size, mtimeMs, ino, relative }) => ({
    path,
    size,
    mtimeMs,
    ino,
    sessionId: basename(path, '.jsonl'),
    fallbackProject: projectFromPath(relative),
  }));
}

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
    model: String(msg.model ?? msg.modelId ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
    ts,
    messageId: typeof obj.id === 'string' && obj.id ? obj.id : null,
    requestId: null,
    uuid: null,
    sidechain: false,
  };
}

export const createFileParser = statelessParser(parseObject);
