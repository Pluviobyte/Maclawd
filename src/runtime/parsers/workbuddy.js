import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import {
  pickCount, resolveInclusiveInput, toCount, UNKNOWN_MODEL,
} from '../usage-record.js';
import { statelessParser } from '../parser-kit.js';

export const id = 'workbuddy';
export const label = 'WorkBuddy';
export const lineFilter = '"usage"';

/** MACLAWD_WORKBUDDY_DIR 是测试与诊断用的覆盖入口。 */
export function projectsDir() {
  const override = process.env.MACLAWD_WORKBUDDY_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.workbuddy', 'projects');
}

export function dataDirs() {
  return [projectsDir()];
}

export function roots() {
  return [projectsDir()];
}

function projectFromEncodedDir(relative) {
  if (!relative) return null;
  const firstSegment = relative.split(sep)[0];
  if (!firstSegment) return null;
  const parts = firstSegment.split('-').filter(Boolean);
  return parts.at(-1) || null;
}

export function discover({ listJsonl }) {
  const base = projectsDir();
  return listJsonl(base).map(({ path, size, mtimeMs, ino, relative }) => ({
    path,
    size,
    mtimeMs,
    ino,
    sessionId: basename(path, '.jsonl'),
    fallbackProject: projectFromEncodedDir(relative),
  }));
}

/** WorkBuddy 的时间戳可能是 epoch 秒、epoch 毫秒或 ISO 字符串。 */
function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 10^10 秒 ≈ 2286 年，超过它一定是毫秒。
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = new Date(value).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** 从 *_tokens_details 这类嵌套结构里累加某个字段，兼容对象与数组两种形态。 */
function detailTotal(value, ...keys) {
  if (!value) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + pickCount(item, ...keys), 0);
  }
  return pickCount(value, ...keys);
}

/**
 * WorkBuddy 是多供应商壳，同一条记录可能有三份 usage：
 * message.usage（归一）、providerData.usage、providerData.rawUsage（原始）。
 * 取第一份 input+output 非零的作为主来源，缓存字段跨全部来源取最大值。
 *
 * 实测要点（~/.workbuddy/projects 真实数据）：
 *   - usage 挂在 type: "function_call" 记录上，不是 "assistant"，所以不按 type 过滤
 *   - total_tokens == input_tokens + output_tokens 成立 → input **含缓存**，必须减掉
 *   - completion_tokens_details.reasoning_tokens ⊂ completion_tokens，满足不变量 2
 *   - 顶层 id 会在同一轮的多条记录间重复（gen-…），**不能**当去重键；
 *     只有 providerData.messageId 是每次模型调用唯一的
 */
export function parseObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const message = (obj.message && typeof obj.message === 'object') ? obj.message : {};
  const provider = (obj.providerData && typeof obj.providerData === 'object')
    ? obj.providerData
    : (message.providerData && typeof message.providerData === 'object' ? message.providerData : {});

  const sources = [message.usage, provider.usage, provider.rawUsage]
    .filter((x) => x && typeof x === 'object');
  if (sources.length === 0) return null;

  let selected = null;
  let inputTotal = 0;
  let output = 0;
  for (const source of sources) {
    const inp = pickCount(source, 'input_tokens', 'inputTokens', 'input', 'prompt_tokens');
    const out = pickCount(source, 'output_tokens', 'outputTokens', 'output', 'completion_tokens');
    if (inp + out > 0) {
      selected = source;
      inputTotal = inp;
      output = out;
      break;
    }
  }
  if (!selected) return null;

  let cacheRead = 0;
  let cacheWriteRaw = 0;
  let reasoning = 0;
  let total = null;
  for (const source of sources) {
    cacheRead = Math.max(
      cacheRead,
      pickCount(source, 'cache_read_input_tokens', 'cacheReadInputTokens',
        'cache_read', 'cacheRead', 'cached_tokens', 'cachedTokens'),
      pickCount(source, 'prompt_cache_hit_tokens'),
      detailTotal(source.inputTokensDetails, 'cached_tokens', 'cachedTokens'),
      detailTotal(source.input_tokens_details, 'cached_tokens', 'cachedTokens'),
      detailTotal(source.prompt_tokens_details, 'cached_tokens', 'cachedTokens'),
    );
    cacheWriteRaw = Math.max(
      cacheWriteRaw,
      pickCount(source, 'cache_creation_input_tokens', 'cacheCreationInputTokens',
        'cache_write_input_tokens', 'cacheWriteInputTokens',
        'prompt_cache_write_tokens', 'cache_write', 'cacheWrite'),
    );
    reasoning = Math.max(
      reasoning,
      pickCount(source, 'reasoning_tokens', 'reasoningTokens', 'reasoning'),
      detailTotal(source.completion_tokens_details, 'reasoning_tokens', 'reasoningTokens'),
      detailTotal(source.completionTokensDetails, 'reasoning_tokens', 'reasoningTokens'),
      detailTotal(source.output_tokens_details, 'reasoning_tokens', 'reasoningTokens'),
    );
    const candidate = pickCount(source, 'total_tokens', 'totalTokens', 'total');
    if (candidate > 0 && total === null) total = candidate;
  }

  const resolved = resolveInclusiveInput({
    input: inputTotal,
    output,
    cacheRead,
    cacheWrite: cacheWriteRaw,
    total,
  });

  const ts = parseTimestamp(obj.timestamp ?? message.timestamp);
  if (ts === null) return null;

  const model = provider.requestModelName || provider.requestModelId || provider.model
    || message.model || obj.model || UNKNOWN_MODEL;

  // reasoning 只是 output 的展示用子集，截断到 output 以内防止显示矛盾。
  const outputTokens = toCount(output);

  return {
    source: id,
    input: resolved.input,
    output: outputTokens,
    cacheRead: resolved.cacheRead,
    // WorkBuddy 不区分缓存写 TTL，全部记进 5m 档。
    write5m: resolved.cacheWrite,
    write1h: 0,
    reasoning: Math.min(reasoning, outputTokens),
    model: String(model).trim() || UNKNOWN_MODEL,
    cwd: typeof obj.cwd === 'string' && obj.cwd.trim() ? obj.cwd : null,
    ts,
    // 顶层 id 在同一轮内重复，只有 messageId 唯一。
    messageId: typeof provider.messageId === 'string' && provider.messageId
      ? provider.messageId
      : null,
    requestId: provider.conversationRequestId || null,
    uuid: obj.id ? `${obj.id}:${ts}` : null,
    sidechain: false,
  };
}

/** WorkBuddy 的记录彼此独立，无需跨行状态。 */
export const createFileParser = statelessParser(parseObject);
