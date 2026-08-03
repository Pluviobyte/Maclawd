import {
  addInto, billable, cacheWrite, emptyBucket, hitRate, mergeBucket, throughput,
} from './usage-record.js';

/**
 * 日聚合与区间计算。见 design/token-tracking.md「统计合同」§8 与「存储契约」。
 *
 * 只预聚合到「日」，7 个区间读取时再算。tokei 预存 7 个区间，但 days 最多 365 条，
 * 读时算的开销可以忽略，且不存在跨天边界失效的问题。
 *
 * 存的是 token 明细而非成本——成本在读取时按当前价格表推导，价格表更新自动修正
 * 全部历史，不需要 tokei 那样的 _recalc_costs 重算过程。
 */

export const ROLLUP_VERSION = 3;

export const RANGES = [
  'today', 'yesterday', 'week', 'last_week', 'month', 'year', 'all',
];

/** 归入本地时区的日期键。ISO 日期串可直接按字典序比较。 */
export function localDayKey(ts) {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function localHour(ts) {
  return new Date(ts).getHours();
}

/** UTC epoch keeps repeated/skipped DST hours distinct while still sorting numerically. */
export function halfHourStart(ts) {
  const value = Number(ts);
  return Math.floor(value / (30 * 60 * 1000)) * 30 * 60 * 1000;
}

function dayKeyFromDate(d) {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function shiftDays(d, delta) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/** 周一为一周之始。 */
function startOfWeek(d) {
  const day = startOfDay(d);
  const weekday = (day.getDay() + 6) % 7;
  return shiftDays(day, -weekday);
}

export function rangeBounds(now = new Date()) {
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  return {
    today: dayKeyFromDate(today),
    yesterday: dayKeyFromDate(shiftDays(today, -1)),
    weekStart: dayKeyFromDate(weekStart),
    lastWeekStart: dayKeyFromDate(shiftDays(weekStart, -7)),
    monthStart: dayKeyFromDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    yearStart: dayKeyFromDate(new Date(now.getFullYear(), 0, 1)),
  };
}

export function dayKeysInRange(dayKeys, range, now = new Date()) {
  const b = rangeBounds(now);
  const keep = (key) => {
    switch (range) {
      case 'today': return key === b.today;
      case 'yesterday': return key === b.yesterday;
      case 'week': return key >= b.weekStart;
      case 'last_week': return key >= b.lastWeekStart && key < b.weekStart;
      case 'month': return key >= b.monthStart;
      case 'year': return key >= b.yearStart;
      case 'all': return true;
      default: throw new Error(`未知区间: ${range}`);
    }
  };
  return dayKeys.filter(keep).sort();
}

/**
 * 每个 source 存 (模型 × 项目) 的交叉单元，而不是分开的两张表。
 *
 * 分维度存只能单独按模型或按项目看；交叉存才能支持「模型 A 在项目 B 上花了多少」
 * 这种联动筛选——vibecafe.ai/usage 的多维筛选就是这个能力。代价是单元数从
 * (模型+项目) 变成 (模型×项目)，实测 113 天约 1MB，可以接受。
 */
const CELL_SEP = '\u0000';

function emptySource() {
  return { ...emptyBucket(), cells: {} };
}

export function cellKey(model, project) {
  return `${model}${CELL_SEP}${project}`;
}

export function splitCellKey(key) {
  const index = key.indexOf(CELL_SEP);
  return index < 0
    ? { model: key, project: 'unknown' }
    : { model: key.slice(0, index), project: key.slice(index + CELL_SEP.length) };
}

function emptyDay() {
  return { hours: new Array(24).fill(0), sources: {} };
}

function emptySlot() {
  return { sources: {} };
}

function addRecordToSource(container, record) {
  const sourceId = record.source ?? 'unknown';
  const source = container.sources[sourceId] ?? (container.sources[sourceId] = emptySource());
  addInto(source, record);

  const model = record.model || 'unknown';
  const project = record.project || 'unknown';
  const key = cellKey(model, project);
  const cell = source.cells[key] ?? (source.cells[key] = emptyBucket());
  addInto(cell, record);
}

/** 记录 → 日聚合。records 必须已经去重。 */
export function buildRollup(records, sessionsBySource = {}, projectPaths = {}) {
  const days = {};
  const slots = {};

  for (const record of records) {
    const dayKey = localDayKey(record.ts);
    const day = days[dayKey] ?? (days[dayKey] = emptyDay());
    addRecordToSource(day, record);

    const slotKey = String(halfHourStart(record.ts));
    const slot = slots[slotKey] ?? (slots[slotKey] = emptySlot());
    addRecordToSource(slot, record);

    // hours 是跨 source 汇总的吞吐量，供作息视图使用。
    day.hours[localHour(record.ts)] += throughput(record);
  }

  // 会话指标独立于日聚合：一个会话可能跨天，按日切分会把 activeSeconds 算错。
  // 区间过滤在读取时按 firstTs/lastTs 做。
  const sessions = {};
  for (const [source, list] of Object.entries(sessionsBySource)) {
    if (Array.isArray(list) && list.length > 0) sessions[source] = list;
  }
  return { v: ROLLUP_VERSION, days, slots, sessions, projectPaths };
}

function accumulate(map, key, bucket) {
  const target = map[key] ?? (map[key] = emptyBucket());
  mergeBucket(target, bucket);
}

/**
 * 把某个区间的日聚合压成一份摘要。
 *
 * priceBucket 可选；传入时同时给出成本与未计价 token 数——未知模型不猜价格，
 * 而是如实报告「有多少 token 没能计价」，比编一个数字更诚实。
 */
export function summarize(rollup, range, {
  now = new Date(),
  priceBucket = null,
  source = null,
  model = null,
  project = null,
} = {}) {
  const days = rollup?.days ?? {};
  const keys = dayKeysInRange(Object.keys(days), range, now);
  const filtered = Boolean(source || model || project);

  const total = emptyBucket();
  const hours = new Array(24).fill(0);
  const byModel = {};
  const byProject = {};
  const bySource = {};
  const daily = [];

  for (const key of keys) {
    const day = days[key];
    if (!day) continue;

    const dayTotal = emptyBucket();
    for (const [sourceId, sourceBucket] of Object.entries(day.sources ?? {})) {
      if (source && sourceId !== source) continue;
      for (const [cell, bucket] of Object.entries(sourceBucket.cells ?? {})) {
        const parts = splitCellKey(cell);
        if (model && parts.model !== model) continue;
        if (project && parts.project !== project) continue;
        mergeBucket(total, bucket);
        mergeBucket(dayTotal, bucket);
        accumulate(bySource, sourceId, bucket);
        accumulate(byModel, parts.model, bucket);
        accumulate(byProject, parts.project, bucket);
      }
    }

    // 未筛选时用预聚合的 hours；一旦筛选，跨 source 汇总的 hours 就不成立了，
    // 此时按当日筛选结果均摊无从考据，宁可留空让前端隐藏作息图。
    if (!filtered) {
      for (let h = 0; h < 24; h++) hours[h] += day.hours?.[h] ?? 0;
    }

    daily.push({ day: key, ...dayTotal, throughput: throughput(dayTotal), billable: billable(dayTotal) });
  }

  let cost = null;
  let unpricedTokens = 0;
  const unpricedModels = [];
  if (priceBucket) {
    cost = 0;
    for (const [model, bucket] of Object.entries(byModel)) {
      const value = priceBucket(model, bucket);
      if (value === null) {
        unpricedTokens += throughput(bucket);
        // 列出具体是哪些模型，用户才能往 pricing.overrides.json 里补。
        if (throughput(bucket) > 0) unpricedModels.push(model);
      } else {
        cost += value;
      }
    }
    unpricedModels.sort();
  }

  return {
    range,
    filtered,
    hoursAvailable: !filtered,
    days: keys,
    ...total,
    cacheWrite: cacheWrite(total),
    billable: billable(total),
    throughput: throughput(total),
    hitRate: hitRate(total),
    hours,
    byModel,
    byProject,
    bySource,
    daily,
    cost,
    unpricedTokens,
    unpricedModels,
  };
}

/**
 * 个人动态基线：过去 N 天里有活动的日子的中位数。
 *
 * 「比平时多/少」必须相对个人自己，固定阈值会让重度用户永远看到红色。
 * 同样的基线也驱动桌宠的 energy（见 design/token-experience.md 第 3 层）。
 */
export function baseline(rollup, { now = new Date(), days = 14, metric = throughput } = {}) {
  const allDays = rollup?.days ?? {};
  const todayKey = dayKeyFromDate(startOfDay(now));
  const values = [];

  for (let i = 1; i <= days; i++) {
    const key = dayKeyFromDate(shiftDays(startOfDay(now), -i));
    if (key === todayKey) continue;
    const day = allDays[key];
    if (!day) continue;
    const bucket = emptyBucket();
    for (const sourceBucket of Object.values(day.sources ?? {})) {
      mergeBucket(bucket, sourceBucket);
    }
    const value = metric(bucket);
    if (value > 0) values.push(value);
  }

  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[mid]
    : Math.round((values[mid - 1] + values[mid]) / 2);
}
