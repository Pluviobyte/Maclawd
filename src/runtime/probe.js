import { existsSync, readFileSync } from 'node:fs';
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

/**
 * 抽样源文件里出现过的键名。
 *
 * 为什么需要它：probe 此前只看**解析结果**，于是把两件完全不同的事
 * 报成了同一个警告——「我们没提取到」和「源数据里压根没有」。
 * 实测三条警告全是后者：Gemini 的会话日志没有任何 token 字段、
 * Qwen 与 OpenClaw 的记录没有任何项目字段。
 *
 * 这类误报比不报更糟：它让人去查一个不存在的 bug。
 * （这条教训在本项目里已经写过一次——probe 刚上线时就误报过两次。）
 *
 * 只抽样：最多 3 个文件 × 前 40 行，够判断「有没有这类字段」，
 * 不为一个诊断把用户几百兆的日志全读一遍。
 */
function sampleKeys(files) {
  const keys = new Set();
  for (const file of files.slice(0, 3)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n', 40)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      collectKeys(parsed, keys, 0);
    }
  }
  return keys;
}

function collectKeys(node, into, depth) {
  if (depth > 4 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 6)) collectKeys(item, into, depth + 1);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    into.add(key.toLowerCase());
    collectKeys(value, into, depth + 1);
  }
}

const hasAny = (keys, needles) => [...keys].some((k) => needles.some((n) => k.includes(n)));
const TOKEN_KEYS = ['token', 'usage'];
const PROJECT_KEYS = ['project', 'cwd', 'workspace', 'repo'];

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
    return { count: 0, bytes: 0, newest: null, paths: [] };
  }
  let bytes = 0;
  let newest = 0;
  for (const candidate of candidates) {
    bytes += candidate.size ?? 0;
    newest = Math.max(newest, candidate.mtimeMs ?? 0);
  }
  // paths 要带出去：诊断「源里到底有没有这个字段」必须能回去读原文件，
  // 只有统计数字是判断不了的。
  return {
    count: candidates.length,
    bytes,
    newest: newest || null,
    paths: candidates.map((c) => c.path).filter(Boolean),
  };
}

/**
 * 不变量检查。每一条都要能回答「查出来说明哪里错了」，
 * 查不出问题的检查项没有价值。
 */
export function runChecks({ parser, records, files, now = Date.now(), scanComplete = true }) {
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
    // 「0 条记录」以前一律报警告，但它其实有两种完全不同的成因，
    // 只有一种是 bug。先去源文件里看有没有 token 字段再下结论——
    // 报一个不存在的 bug 会让人白查半天。
    const size = `${files.count} 个文件（${(files.bytes / 1024).toFixed(0)}KB）`;
    // 冷重建有工作预算，一轮跑不完就把剩下的推到下一轮。这时候还没轮到的
    // 解析器当然是 0 条——那不是 bug。不加这道判断的话，
    // 本来为了消灭误报做的检查自己会变成一个**偶发**误报，更难判断。
    if (!scanComplete) {
      add(LEVEL.info, 'scan-incomplete',
        `${size}，但本轮扫描还没跑完（冷建有工作预算，剩下的会在下一轮继续）。`
        + '再跑一次 probe 才能判断。');
      return checks;
    }
    if (!hasAny(sampleKeys(files.paths), TOKEN_KEYS)) {
      add(LEVEL.info, 'no-usage-fields',
        `${size}，但日志里**没有任何 token 字段**——这个工具的这份日志不记用量，`
        + '解析出 0 条是对的，不是解析器的问题。');
    } else {
      add(LEVEL.warn, 'no-records',
        `${size}里有 token 字段，却解析出 0 条记录——`
        + '结构与解析器的假设对不上，这是真 bug。');
    }
    return checks;
  }

  const total = sumRecords(records);
  const bill = billable(total);
  const tput = throughput(total);

  // ---- 不变量 1：三类输入互斥 ----
  if (tput < bill) {
    add(LEVEL.fail, 'throughput-lt-billable',
      `吞吐量(${tput}) 小于非缓存读取量(${bill})，数学上不可能，缓存字段被算成了负数。`);
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
    // 同理：源数据里根本没有项目字段时，unknown 是**正确**结果。
    // Qwen 的用量日志与 OpenClaw 的记录都属于这种，此前被误报成 bug。
    if (hasAny(sampleKeys(files.paths), PROJECT_KEYS)) {
      add(LEVEL.warn, 'project-unknown',
        '源数据里有项目字段，但全部记录的项目都是 unknown——提取没生效。');
    } else {
      add(LEVEL.info, 'project-not-recorded',
        '这个工具的日志本身不含项目信息，所以项目一律是 unknown——按用量口径统计不受影响。');
    }
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
  // indexing 非空 = 这一轮有文件被工作预算推迟了，结果是不完整的。
  const scanComplete = !result.indexing;

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
      checks: runChecks({ parser, records, files, now, scanComplete }),
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
