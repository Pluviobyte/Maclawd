import { homedir } from 'node:os';
import { join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { statelessParser } from '../parser-kit.js';

export const id = 'kimi-code';
export const label = 'Kimi Code';

/**
 * ⚠️ 只认 usage.record，不能同时收 step.end。
 *
 * 实测 ~/.kimi-code 的 wire.jsonl 里，同一次调用会写出两条记录：
 *   {"type":"step.end",    "event":{...,"usage":{inputOther,output,inputCacheRead,inputCacheCreation}}}
 *   {"type":"usage.record","model":"kimi-code/kimi-for-coding","usage":{完全相同的四个数}}
 * 两条都收就是整体翻倍。取 usage.record 是因为它自带 model，而 step.end 没有。
 */
export const lineFilter = '"usage.record"';

/** 数据根解析顺序与 Kimi CLI 自身一致。 */
export function dataRoots() {
  const override = process.env.MACLAWD_KIMI_CODE_DIR?.trim();
  const current = override || process.env.KIMI_CODE_HOME?.trim() || join(homedir(), '.kimi-code');
  // `kimi migrate` 不搬用量记录，所以新旧两个库要一起读，不是二选一。
  const legacy = process.env.MACLAWD_KIMI_LEGACY_DIR?.trim() || join(homedir(), '.kimi');
  return [current, legacy];
}

export function dataDirs() {
  return dataRoots().map((root) => join(root, 'sessions'));
}

/** wd_<slug>_<hash> → slug，作为项目名的兜底。 */
function projectFromWorkdirSlug(relative) {
  const first = relative.split(/[\\/]/)[0] ?? '';
  const match = first.match(/^wd_(.+)_[0-9a-f]{8,}$/);
  return match ? match[1] : null;
}

export function discover({ listJsonl }) {
  const candidates = [];
  for (const dir of dataDirs()) {
    for (const { path, size, mtimeMs, ino, relative } of listJsonl(dir)) {
      if (!path.endsWith('wire.jsonl')) continue;
      candidates.push({
        path,
        size,
        mtimeMs,
        ino,
        // 同一 session 目录下主 wire 与各 subagent wire 是不同文件，都要计入，
        // 所以用完整路径做 key——用 session 目录会让 scan.js 只保留其中一个。
        sessionId: path,
        fallbackProject: projectFromWorkdirSlug(relative),
      });
    }
  }
  return candidates;
}

export function parseObject(obj) {
  if (!obj || obj.type !== 'usage.record') return null;
  const usage = obj.usage;
  if (!usage || typeof usage !== 'object') return null;

  const ts = typeof obj.time === 'number' && Number.isFinite(obj.time) ? obj.time : null;
  if (ts === null) return null;

  // 四个字段互不重叠：inputOther 已经是「非缓存」的那部分，不需要减法。
  const input = toCount(usage.inputOther);
  const output = toCount(usage.output);
  const cacheRead = toCount(usage.inputCacheRead);
  const cacheWrite = toCount(usage.inputCacheCreation);
  if (input + output + cacheRead + cacheWrite === 0) return null;

  const model = typeof obj.model === 'string' && obj.model.trim()
    ? obj.model.trim()
    : UNKNOWN_MODEL;

  return {
    source: id,
    input,
    output,
    cacheRead,
    write5m: cacheWrite,
    write1h: 0,
    // Kimi 不单列推理 token。
    reasoning: 0,
    model,
    cwd: null,
    ts,
    // usage.record 没有 id 字段。用「时刻 + 模型 + 四个数」当键，可以挡住同一条增量
    // 被写两次；不同调用几乎不可能在同一毫秒产出完全相同的四元组。
    messageId: `${ts}|${model}|${input}|${output}|${cacheRead}|${cacheWrite}`,
    requestId: obj.usageScope ?? null,
    uuid: null,
    sidechain: false,
  };
}

export const createFileParser = statelessParser(parseObject);
