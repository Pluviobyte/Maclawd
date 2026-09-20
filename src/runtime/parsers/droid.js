import { readFileSync, statSync } from 'node:fs';
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

function settingsPaths() {
  if (process.env.MACLAWD_DROID_SETTINGS) return [process.env.MACLAWD_DROID_SETTINGS];
  if (process.env.MACLAWD_DROID_DIR) return [];
  return ['config.json', 'settings.json'].map(name => join(homedir(), '.factory', name));
}
function signature(path) {
  try { const s = statSync(path); return [s.ino, s.size, s.mtimeMs]; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function resolveModel(raw) {
  let model = typeof raw === 'string' ? raw.trim() : '';
  // Vibe b4a3874 / Factory BYOK: configuration id is not the API model name.
  for (const path of settingsPaths()) {
    let data;
    try { data = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const item of [...(Array.isArray(data.custom_models) ? data.custom_models : []),
      ...(Array.isArray(data.customModels) ? data.customModels : [])]) {
      if (item?.id === raw && typeof item.model === 'string' && item.model.trim()) model = item.model.trim();
    }
  }
  return /^(auto|default|default-model|fast|turbo|lite|ultimate|performance|efficient)$/i.test(model)
    ? `droid-${model.toLowerCase()}` : model || UNKNOWN_MODEL;
}

export function discover({ listJsonl }) {
  return listJsonl(sessionsDir())
    .filter(({ path }) => !path.endsWith('.settings.json'))
    .map(({ path, size, mtimeMs, ino }) => ({
      path, size, mtimeMs, ino, sessionId: path, fallbackProject: null,
      cacheKey: JSON.stringify([signature(path.replace(/\.jsonl$/, '.settings.json')),
        ...settingsPaths().map(signature)]),
    }));
}

/**
 * Droid 把用量放在会话的**旁挂设置文件**里，而不是日志行里：
 *   sessions/<id>.jsonl          消息流（只用来取首条消息的时间戳与 cwd）
 *   sessions/<id>.settings.json  { model, tokenUsage: {...} }
 *
 * 所以一个会话只产出一条聚合记录，时间戳取首条消息。
 * `inputTokens` 是非缓存输入，`outputTokens` **含** thinkingTokens。
 */
export function createFileParser({ candidate, state } = {}) {
  let firstTs = state?.firstTs ?? null;
  let cwd = state?.cwd ?? null;

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
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
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

      // Vibe #105 + tokenleak fd38fa29 independently keep sidecar input uncached.
      const input = rawInput;
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
          model: resolveModel(settings.model),
          cwd,
          ts: firstTs,
          // 一个会话一条记录，用会话 id 当键。
          messageId: sessionId,
          requestId: null,
          uuid: null,
          sidechain: false,
        }],
        state: { firstTs, cwd },
        resetRecords: true,
      };
    },
  };
}
