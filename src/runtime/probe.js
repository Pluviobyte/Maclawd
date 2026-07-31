import { existsSync } from 'node:fs';
import { parsers as allParsers, VERIFIED_SOURCES } from './parsers/index.js';
import { listJsonl, scanAll } from './scan.js';
import { billable, cacheWrite, hitRate, throughput } from './usage-record.js';

/**
 * 解析器体检。
 *
 * 为什么需要它：21 个解析器里只有 7 个有真实样本验证过。剩下的是照
 * vibe-usage 的口径移植的，**能跑通不等于算得对**——字段名对得上但语义搞反
 * （比如 input 到底含不含缓存）会产出看起来正常、实际差一个数量级的数字。
 *
 * 这里把「肉眼看看对不对」变成一组可自动判定的不变量检查。
 * 检查项全部来自本项目已经踩过的真实坑，不是凭空想的：
 *   - Kimi 的 step.end / usage.record 双计（同一组数字被记两遍）
 *   - WorkBuddy 用 id 去重会少算（去重键选错，折叠过度）
 *   - 各家 input 含不含缓存不一致（不变量 1）
 *   - reasoning 是否已包含在 output 里（不变量 2）
 */

const LEVEL = { ok: 'ok', warn: 'warn', fail: 'fail', info: 'info' };

/** 单条记录的荒谬阈值。超过多半是把累计值当成了增量。 */
const ABSURD_SINGLE_RECORD = 50_000_000;
const EARLIEST_PLAUSIBLE = Date.UTC(2022, 0, 1);

function sumRecords(records) {
  const total = {
    input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0,
  };
  for (const r of records) {
    total.input += r.input || 0;
    total.output += r.output || 0;
    total.cacheRead += r.cacheRead || 0;
    total.write5m += r.write5m || 0;
    total.write1h += r.write1h || 0;
    total.reasoning += r.reasoning || 0;
  }
  return total;
}

/**
 * 只统计**解析器自己认领的**文件。
 *
 * 早先版本按扩展名扫整个数据目录，结果把 ~/.hermes 下无关的 json、
 * ~/.openclaw 下插件目录里的 json 都算进来，报出「326 个文件却只有 1 条记录」
 * 这种吓人但完全错误的结论。误报会浪费排查者的时间，比不报还糟。
 */
function fileStats(parser) {
  let candidates;
  try {
    candidates = parser.discover({ listJsonl }) ?? [];
  } catch {
    return { count: 0, bytes: 0, newest: null };
  }
  let bytes = 0;
  let newest = 0;
  for (const candidate of candidates) {
    bytes += candidate.size ?? 0;
    newest = Math.max(newest, candidate.mtimeMs ?? 0);
  }
  return { count: candidates.length, bytes, newest: newest || null };
}

/**
 * 不变量检查。每一条都要能回答「查出来说明哪里错了」，
 * 查不出问题的检查项没有价值。
 */
export function runChecks({ parser, records, files, now = Date.now() }) {
  const checks = [];
  const add = (level, id, message) => checks.push({ level, id, message });

  const installed = parser.dataDirs().some((d) => existsSync(d));
  if (!installed) {
    add(LEVEL.info, 'not-installed', '未检测到该工具的数据目录，跳过。');
    return checks;
  }

  if (files.count === 0) {
    add(LEVEL.info, 'no-files', '目录存在但没有数据文件——这个工具可能还没被用过。');
    return checks;
  }

  if (records.length === 0 && parser.enabled && parser.enabled() === false) {
    add(LEVEL.info, 'disabled', '该解析器被设置显式关闭，未产出记录属正常。');
    return checks;
  }

  if (records.length === 0) {
    // 「0 条记录」有两种可能，工具自己分不清，必须让人来判断：
    //   a) 这个工具装了但还没真正对话过（正常）
    //   b) 日志结构与解析器假设不一致（真 bug）
    // 实测就撞到过 a：Gemini 的会话文件里只有一条 user 消息，没有模型输出。
    add(LEVEL.warn, 'no-records',
      `发现 ${files.count} 个文件（${(files.bytes / 1024).toFixed(0)}KB）却解析出 0 条记录。`
      + '\n      如果你**确实用它生成过内容**，这就是解析器的 bug，最需要反馈；'
      + '\n      如果只是装了没真正对话过，属正常。');
    return checks;
  }

  const total = sumRecords(records);
  const bill = billable(total);
  const tput = throughput(total);

  // ---- 不变量 1：三类输入互斥 ----
  if (tput < bill) {
    add(LEVEL.fail, 'throughput-lt-billable',
      `吞吐量(${tput}) 小于计费量(${bill})，数学上不可能，缓存字段被算成了负数。`);
  }
  const rate = hitRate(total);
  if (rate < 0 || rate > 1) {
    add(LEVEL.fail, 'hitrate-range', `缓存命中率 ${(rate * 100).toFixed(1)}% 越界。`);
  }

  // ---- 不变量 2：output 含 reasoning ----
  const overReasoning = records.filter((r) => (r.reasoning || 0) > (r.output || 0));
  if (overReasoning.length > 0) {
    add(LEVEL.fail, 'reasoning-gt-output',
      `${overReasoning.length} 条记录的 reasoning 超过 output。`
      + '说明该工具把推理与输出分开上报，解析器却当成了包含关系（不变量 2）。');
  }

  // ---- 负数与非有限值 ----
  const negative = records.filter((r) => [r.input, r.output, r.cacheRead, r.write5m, r.write1h]
    .some((v) => !Number.isFinite(v) || v < 0));
  if (negative.length > 0) {
    add(LEVEL.fail, 'negative', `${negative.length} 条记录含负数或非有限值。`);
  }

  // ---- 时间戳 ----
  const badTime = records.filter((r) => !Number.isFinite(r.ts)
    || r.ts < EARLIEST_PLAUSIBLE || r.ts > now + 86_400_000);
  if (badTime.length > 0) {
    const sample = new Date(badTime[0].ts).toISOString();
    add(LEVEL.fail, 'timestamp',
      `${badTime.length} 条记录时间戳不合理（例如 ${sample}）。`
      + '常见原因是把秒当成了毫秒，或反过来。');
  }

  // ---- 单条过大：多半把累计值当增量 ----
  const absurd = records.filter((r) => throughput(r) > ABSURD_SINGLE_RECORD);
  if (absurd.length > 0) {
    add(LEVEL.warn, 'absurd-single',
      `${absurd.length} 条单条记录吞吐超过 ${ABSURD_SINGLE_RECORD / 1e6}M。`
      + '如果该工具上报的是**累计值**，解析器必须做差分，否则会严重高估。');
  }

  // ---- 模型与项目提取 ----
  const models = new Set(records.map((r) => r.model));
  if (models.size === 1 && models.has('unknown')) {
    add(LEVEL.warn, 'model-unknown', '全部记录的模型都是 unknown，模型名提取没生效——成本将无法计算。');
  }
  const projects = new Set(records.map((r) => r.project ?? 'unknown'));
  if (projects.size === 1 && projects.has('unknown')) {
    add(LEVEL.warn, 'project-unknown', '全部记录的项目都是 unknown，项目归属没生效。');
  }

  // ---- 去重键健康度 ----
  const keyed = records.filter((r) => r.messageId || r.uuid);
  if (keyed.length === 0) {
    add(LEVEL.warn, 'no-dedupe-key',
      '没有任何记录带去重键，重复扫描或 fork 会导致重复计数。');
  } else {
    const keys = new Set(keyed.map((r) => `${r.messageId ?? ''}|${r.uuid ?? ''}`));
    const collapse = 1 - keys.size / keyed.length;
    if (collapse > 0.5) {
      add(LEVEL.warn, 'over-collapse',
        `去重键把 ${(collapse * 100).toFixed(0)}% 的记录判为同一条。`
        + '键可能选得太粗（例如用了会话 id 而不是消息 id），会少算。');
    }
  }

  // ---- 全零 ----
  if (tput === 0) {
    add(LEVEL.fail, 'all-zero', `解析出 ${records.length} 条记录但 token 全为 0，字段名没对上。`);
  }

  if (checks.every((c) => c.level === LEVEL.ok || c.level === LEVEL.info)) {
    add(LEVEL.ok, 'passed', `${records.length} 条记录通过全部不变量检查。`);
  }
  return checks;
}

/** 对全部（或指定）解析器做一次体检。 */
export async function probe({ sources = null, parsers = allParsers } = {}) {
  const selected = sources
    ? parsers.filter((p) => sources.includes(p.id))
    : parsers;

  const result = await scanAll({ parsers: selected, ignoreSettings: true });
  const now = Date.now();

  return selected.map((parser) => {
    const records = result.bySource[parser.id] ?? [];
    const files = fileStats(parser);
    const total = sumRecords(records);
    return {
      source: parser.id,
      label: parser.label,
      verified: VERIFIED_SOURCES.has(parser.id),
      installed: parser.dataDirs().some((d) => existsSync(d)),
      dirs: parser.dataDirs(),
      files,
      records: records.length,
      total,
      derived: {
        cacheWrite: cacheWrite(total),
        billable: billable(total),
        throughput: throughput(total),
        hitRate: hitRate(total),
        ratio: billable(total) > 0 ? throughput(total) / billable(total) : 0,
      },
      models: [...new Set(records.map((r) => r.model))].sort().slice(0, 8),
      projects: [...new Set(records.map((r) => r.project ?? 'unknown'))].sort().slice(0, 8),
      newest: records.length > 0 ? Math.max(...records.map((r) => r.ts)) : null,
      checks: runChecks({ parser, records, files, now }),
    };
  });
}

/** 与上一次快照对比，回答「刚才那一次操作被记到了吗」。 */
export function diffProbe(before, after) {
  const previous = new Map((before ?? []).map((entry) => [entry.source, entry]));
  return after.map((entry) => {
    const old = previous.get(entry.source);
    return {
      ...entry,
      delta: {
        records: entry.records - (old?.records ?? 0),
        files: entry.files.count - (old?.files.count ?? 0),
        billable: entry.derived.billable - (old?.derived.billable ?? 0),
        throughput: entry.derived.throughput - (old?.derived.throughput ?? 0),
      },
      hadBaseline: Boolean(old),
    };
  });
}
