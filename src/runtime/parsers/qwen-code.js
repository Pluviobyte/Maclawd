import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveInclusiveInput, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { statelessParser } from '../parser-kit.js';

export const id = 'qwen-code';
export const label = 'Qwen Code';
export const lineFilter = '"inputTokens"';

export function runtimeDir() {
  return process.env.MACLAWD_QWEN_DIR?.trim()
    || process.env.QWEN_RUNTIME_DIR?.trim()
    || join(homedir(), '.qwen');
}

export function dataDirs() {
  return [join(runtimeDir(), 'usage')];
}

export function discover({ listJsonl }) {
  return listJsonl(join(runtimeDir(), 'usage'))
    .filter(({ path }) => /token-usage.*\.jsonl$/.test(path))
    .map(({ path, size, mtimeMs, ino }) => ({
      path,
      size,
      mtimeMs,
      ino,
      sessionId: path,
      fallbackProject: null,
    }));
}

/**
 * 逐请求记录，一行一次模型调用。
 *
 * 实测 ~/.qwen/usage/token-usage-2026-07.jsonl：
 *   totalTokens(28339) == inputTokens(28299) + outputTokens(40)
 * → input **含缓存**（不变量 1，减掉 cachedTokens）；thoughtsTokens 未计入 total，
 *   说明它是 outputTokens 的子集（不变量 2）。
 */
export function parseObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.inputTokens === undefined && obj.outputTokens === undefined) return null;

  const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : NaN;
  if (Number.isNaN(ts)) return null;

  const resolved = resolveInclusiveInput({
    input: obj.inputTokens,
    output: obj.outputTokens,
    cacheRead: obj.cachedTokens,
    cacheWrite: 0,
    total: obj.totalTokens,
  });
  const output = toCount(obj.outputTokens);
  if (resolved.input + output + resolved.cacheRead === 0) return null;

  return {
    source: id,
    input: resolved.input,
    output,
    cacheRead: resolved.cacheRead,
    write5m: 0,
    write1h: 0,
    reasoning: Math.min(toCount(obj.thoughtsTokens), output),
    model: typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : UNKNOWN_MODEL,
    cwd: null,
    ts,
    messageId: typeof obj.id === 'string' && obj.id ? obj.id : null,
    requestId: null,
    uuid: null,
    sidechain: obj.source === 'subagent',
  };
}

export const createFileParser = statelessParser(parseObject);
