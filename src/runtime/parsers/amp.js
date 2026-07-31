import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'amp';
export const label = 'Amp';
// thread 是整份 JSON，不是逐行日志。
export const readMode = 'whole';
export const lineFilter = null;

export function threadsDir() {
  return process.env.MACLAWD_AMP_DIR?.trim()
    || join(homedir(), '.local', 'share', 'amp', 'threads');
}

export function dataDirs() {
  return [threadsDir()];
}

export function discover({ listJsonl }) {
  return listJsonl(threadsDir(), { extensions: ['.json'] })
    .filter(({ path }) => basename(path).startsWith('T-'))
    .map(({ path, size, mtimeMs, ino }) => ({
      path, size, mtimeMs, ino, sessionId: path, fallbackProject: null,
    }));
}

/**
 * Amp 有两种记账形态，优先用账本：
 *   thread.usageLedger.events[]  权威账本，带 model 与 tokens.{input,output}
 *   thread.messages[].usage      账本不存在时的回落
 *
 * 账本事件本身不带缓存读，要顺着 `toMessageId` 回到对应消息去取
 * `usage.cacheReadInputTokens`——vibe-usage 就是这么做的。
 */
export function createFileParser({ candidate } = {}) {
  const records = [];

  return {
    onObject(thread) {
      if (!thread || typeof thread !== 'object') return;
      const messages = Array.isArray(thread.messages) ? thread.messages : [];
      const events = Array.isArray(thread.usageLedger?.events) ? thread.usageLedger.events : [];
      const created = thread.created ? new Date(thread.created).getTime() : NaN;

      const push = ({ input, output, cacheRead, cacheWrite, reasoning, model, ts, key }) => {
        if (input + output + cacheRead + cacheWrite === 0) return;
        records.push({
          source: id,
          input,
          output: toCount(output),
          cacheRead,
          write5m: cacheWrite,
          write1h: 0,
          reasoning: Math.min(reasoning, toCount(output)),
          model: String(model ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
          cwd: null,
          ts,
          messageId: key,
          requestId: null,
          uuid: null,
          sidechain: false,
        });
      };

      if (events.length > 0) {
        events.forEach((event, index) => {
          const ts = new Date(event?.timestamp).getTime();
          if (!Number.isFinite(ts)) return;
          const linked = Number.isInteger(event.toMessageId) ? messages[event.toMessageId] : null;
          push({
            input: pickCount(event.tokens, 'input'),
            output: pickCount(event.tokens, 'output'),
            cacheRead: pickCount(linked?.usage, 'cacheReadInputTokens', 'cache_read_input_tokens'),
            cacheWrite: pickCount(linked?.usage, 'cacheCreationInputTokens', 'cache_creation_input_tokens'),
            reasoning: pickCount(event.tokens, 'reasoning'),
            model: event?.model,
            ts,
            key: `${candidate?.path ?? ''}|ledger|${index}`,
          });
        });
        return;
      }

      messages.forEach((message, index) => {
        const usage = message?.usage;
        if (!usage) return;
        const stamp = message.timestamp ?? thread.created;
        const ts = stamp ? new Date(stamp).getTime() : created;
        if (!Number.isFinite(ts)) return;
        push({
          input: pickCount(usage, 'inputTokens', 'input_tokens'),
          output: pickCount(usage, 'outputTokens', 'output_tokens'),
          cacheRead: pickCount(usage, 'cacheReadInputTokens', 'cache_read_input_tokens'),
          cacheWrite: pickCount(usage, 'cacheCreationInputTokens', 'cache_creation_input_tokens'),
          reasoning: pickCount(usage, 'reasoningTokens'),
          model: usage.model ?? message.model,
          ts,
          key: `${candidate?.path ?? ''}|msg|${index}`,
        });
      });
    },
    finish() {
      return { records, state: null };
    },
  };
}
