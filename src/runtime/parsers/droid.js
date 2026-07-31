import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'droid';
export const label = 'Droid';
export const lineFilter = '"timestamp"';

export function sessionsDir() {
  return process.env.MACLAWD_DROID_DIR?.trim() || join(homedir(), '.factory', 'sessions');
}

export function dataDirs() {
  return [sessionsDir()];
}

export function discover({ listJsonl }) {
  return listJsonl(sessionsDir())
    .filter(({ path }) => !path.endsWith('.settings.json'))
    .map(({ path, size, mtimeMs, ino }) => ({
      path, size, mtimeMs, ino, sessionId: basename(path, '.jsonl'), fallbackProject: null,
    }));
}

/**
 * Droid 把用量放在会话的**旁挂设置文件**里，而不是日志行里：
 *   sessions/<id>.jsonl          消息流（只用来取首条消息的时间戳与 cwd）
 *   sessions/<id>.settings.json  { model, tokenUsage: {...} }
 *
 * 所以一个会话只产出一条聚合记录，时间戳取首条消息。
 * `inputTokens` **含** cacheReadTokens，`outputTokens` **含** thinkingTokens。
 */
export function createFileParser({ candidate } = {}) {
  let firstTs = null;
  let cwd = null;

  return {
    onObject(obj) {
      if (!obj || obj.type !== 'message') return;
      const ts = new Date(obj.timestamp).getTime();
      if (!Number.isFinite(ts)) return;
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (!cwd && typeof obj.cwd === 'string' && obj.cwd.trim()) cwd = obj.cwd;
    },
    finish() {
      if (firstTs === null || !candidate?.path) return { records: [], state: null };

      const sessionId = basename(candidate.path, '.jsonl');
      let settings;
      try {
        settings = JSON.parse(
          readFileSync(join(dirname(candidate.path), `${sessionId}.settings.json`), 'utf-8'),
        );
      } catch {
        // 没有设置文件就没有用量可算
        return { records: [], state: null };
      }

      const usage = settings?.tokenUsage;
      if (!usage) return { records: [], state: null };

      const cacheRead = pickCount(usage, 'cacheReadTokens', 'cache_read_tokens');
      const cacheWrite = pickCount(usage, 'cacheWriteTokens', 'cache_write_tokens', 'cacheCreationTokens');
      const thinking = pickCount(usage, 'thinkingTokens', 'reasoningTokens');
      const rawInput = pickCount(usage, 'inputTokens', 'input_tokens');
      const output = pickCount(usage, 'outputTokens', 'output_tokens');

      // input 含缓存读，减掉后互斥（不变量 1）；output 含思考，原样保留（不变量 2）
      const input = Math.max(0, rawInput - cacheRead - cacheWrite);
      if (input + output + cacheRead + cacheWrite === 0) return { records: [], state: null };

      return {
        records: [{
          source: id,
          input,
          output: toCount(output),
          cacheRead,
          write5m: cacheWrite,
          write1h: 0,
          reasoning: Math.min(thinking, toCount(output)),
          model: String(settings.model ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
          cwd,
          ts: firstTs,
          // 一个会话一条记录，用会话 id 当键。
          messageId: sessionId,
          requestId: null,
          uuid: null,
          sidechain: false,
        }],
        state: null,
      };
    },
  };
}
