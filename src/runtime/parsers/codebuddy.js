import { homedir } from 'node:os';
import { join } from 'node:path';
import { timestamp } from './local-data.js';
import { cacheWriteSplit, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { statelessParser } from '../parser-kit.js';

// Vibe b4a3874, CodeBuddy Code 2.151 writer: separate from WorkBuddy products.
export const id = 'codebuddy';
export const label = 'CodeBuddy CLI';
export const lineFilter = null;
export const dataDirs = () => [join(process.env.MACLAWD_CODEBUDDY_DIR || process.env.CODEBUDDY_CONFIG_DIR || join(homedir(), '.codebuddy'), 'projects')];
export function discover({ listJsonl }) {
  return listJsonl(dataDirs()[0]).map(file => ({ ...file, sessionId: file.path }));
}
const nonempty = (...values) => values.find(v => typeof v === 'string' && v.trim())?.trim();
export function parseObject(obj) {
  const usage = obj?.message?.usage;
  if (!usage || (obj.message.role && obj.message.role !== 'assistant')) return null;
  const ts = timestamp(obj.timestamp) ?? timestamp(obj.message.timestamp);
  if (ts === null) return null;
  const input = toCount(usage.input_tokens), output = toCount(usage.output_tokens), cacheRead = toCount(usage.cache_read_input_tokens);
  const { write5m, write1h } = cacheWriteSplit(usage);
  if (!(input + output + cacheRead + write5m + write1h)) return null;
  let model = nonempty(obj.message.model, obj.providerData?.requestModelId, obj.providerData?.model) || UNKNOWN_MODEL;
  if (/^(auto|default|default-model|fast|turbo|lite|ultimate|performance|efficient)$/i.test(model)) model = `codebuddy-${model.toLowerCase()}`;
  return { source:id, ts, model, cwd:obj.cwd || null, input, output, cacheRead, write5m, write1h,
    reasoning:Math.min(toCount(usage.reasoning_tokens),output),
    billing:{promptTokens:input+cacheRead+write5m+write1h, unknownWriteTTL:!usage.cache_creation && write5m>0},
    // A conversationRequestId spans multiple API calls; it is not an identity.
    messageId:nonempty(obj.message.id,obj.providerData?.messageId,obj.id) || null,
    requestId:null, uuid:null, sidechain:false };
}
export const createFileParser = statelessParser(parseObject);
