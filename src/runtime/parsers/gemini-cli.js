import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { pickCount, resolveInclusiveInput, toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'gemini-cli';
export const label = 'Gemini CLI';
export const lineFilter = (line) => line.includes('"tokens"') || line.includes('"usageMetadata"');

export function tmpDir() {
  return process.env.MACLAWD_GEMINI_DIR?.trim() || join(homedir(), '.gemini', 'tmp');
}

export function dataDirs() {
  return [tmpDir()];
}

export function discover({ listJsonl }) {
  return listJsonl(tmpDir())
    .filter(({ path }) => /session-.*\.jsonl$/.test(path) || path.endsWith('.jsonl'))
    .map(({ path, size, mtimeMs, ino, relative }) => ({
      path,
      size,
      mtimeMs,
      ino,
      // 同一 chats 目录下可能有多个 session 文件，各自独立计入。
      sessionId: path,
      // tmp 下是项目路径的哈希目录，反推不出真实路径，只能留空。
      fallbackProject: relative.split(sep)[0] ? null : null,
    }));
}

/**
 * Gemini 有两代字段：
 *   新  msg.tokens = { input, output, cached, thoughts }
 *   旧  msg.usageMetadata = { promptTokenCount, candidatesTokenCount, cachedContentTokenCount, thoughtsTokenCount }
 *
 * 两代都是 **input 含缓存、output 含思考**，所以 input 要减掉 cached；
 * output 原样保留、thoughts 作为子计数（不变量 1、2）。
 */
function extract(source) {
  if (!source || typeof source !== 'object') return null;
  const input = pickCount(source, 'input', 'promptTokenCount', 'input_tokens', 'prompt_tokens');
  const output = pickCount(source, 'output', 'candidatesTokenCount', 'output_tokens', 'completion_tokens');
  const cached = pickCount(source, 'cached', 'cachedContentTokenCount', 'cached_content_token_count');
  const thoughts = pickCount(source, 'thoughts', 'thoughtsTokenCount', 'thoughts_token_count');
  if (input + output + cached === 0) return null;
  return { input, output, cached, thoughts };
}

/**
 * 实测 ~/.gemini/tmp/<project>/chats/session-*.jsonl 的真实结构：
 *   第一行   会话头 { sessionId, projectHash, startTime, kind }
 *   之后每行 { "$set": { "messages": [ … ] } }   ← MongoDB 风格的更新包装
 *
 * 一行里可能带**多条**消息，所以不能用一进一出的 parseObject。
 * 早先按「每行一条消息」写的版本在真实文件上一条都解析不出来。
 */
export function messagesFrom(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const wrapped = obj.$set?.messages ?? obj.messages;
  if (Array.isArray(wrapped)) return wrapped;
  return [obj];
}

export function parseObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const msg = obj.message ?? obj;
  const raw = extract(msg.tokens) ?? extract(msg.usageMetadata) ?? extract(obj.tokens);
  if (!raw) return null;

  const stamp = obj.timestamp ?? msg.timestamp ?? obj.time ?? msg.time;
  const ts = typeof stamp === 'number' ? stamp : new Date(stamp).getTime();
  if (!Number.isFinite(ts)) return null;

  // input 含缓存：这里 total 传 input+output 以触发减法（Gemini 不单独报 total）。
  const resolved = resolveInclusiveInput({
    input: raw.input,
    output: raw.output,
    cacheRead: raw.cached,
    cacheWrite: 0,
    total: raw.input + raw.output,
  });

  const model = msg.model ?? obj.model ?? UNKNOWN_MODEL;
  return {
    source: id,
    input: resolved.input,
    output: toCount(raw.output),
    cacheRead: resolved.cacheRead,
    write5m: 0,
    write1h: 0,
    reasoning: Math.min(toCount(raw.thoughts), toCount(raw.output)),
    model: String(model).trim() || UNKNOWN_MODEL,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
    ts,
    messageId: msg.id ?? obj.id ?? null,
    requestId: null,
    uuid: obj.uuid ?? null,
    sidechain: false,
  };
}


export function createFileParser() {
  const records = [];
  return {
    onObject(obj) {
      for (const message of messagesFrom(obj)) {
        const record = parseObject(message);
        if (record) records.push(record);
      }
    },
    finish() {
      return { records, state: null };
    },
  };
}
