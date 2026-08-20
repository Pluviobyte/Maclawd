import { billable, emptyBucket, mergeBucket, throughput } from './usage-record.js';
import { splitCellKey } from './rollup.js';
import { summarizeSessions } from './sessions.js';

const SLOT_MS = 30 * 60 * 1000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function shiftDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function startOfWeek(date) {
  const start = startOfDay(date);
  return shiftDays(start, -((start.getDay() + 6) % 7));
}

function mirroredPeriod(start, end) {
  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  return { current: period(start, end), previous: period(previousStart, previousEnd) };
}

function period(from, to) {
  return { from: dayKey(from), to: dayKey(to), fromTs: from.getTime(), toTs: to.getTime() };
}

function relativeBounds(range, now, { from, to, rollup } = {}) {
  if (range === 'all') {
    const starts = Object.keys(rollup?.slots ?? {}).map(Number).filter(Number.isFinite);
    const first = starts.length > 0 ? new Date(Math.min(...starts)) : startOfDay(now);
    return { current: period(first, now), previous: null };
  }
  if (range === '24h') {
    // Rollup 的最细粒度是 30 分钟。用最近 48 个槽（含当前槽）比较前 48 个槽，
    // 两边桶数严格一致；不能拿未对齐的毫秒边界去切整槽并声称“精确”。
    const currentStart = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS - 47 * SLOT_MS;
    const previousStart = currentStart - 48 * SLOT_MS;
    const elapsed = now.getTime() - currentStart;
    return {
      current: period(new Date(currentStart), now),
      previous: period(new Date(previousStart), new Date(previousStart + elapsed)),
    };
  }
  if (range === 'custom') {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
    const duration = end.getTime() - start.getTime() + 1;
    return {
      current: period(start, end),
      previous: period(new Date(start.getTime() - duration), new Date(start.getTime() - 1)),
    };
  }
  if (range === 'today') {
    const start = startOfDay(now);
    const elapsed = now.getTime() - start.getTime();
    const previousStart = shiftDays(start, -1);
    return {
      current: period(start, now),
      previous: period(previousStart, new Date(previousStart.getTime() + elapsed)),
    };
  }
  if (range === 'yesterday') {
    const start = shiftDays(startOfDay(now), -1);
    const end = new Date(startOfDay(now).getTime() - 1);
    return {
      current: period(start, end),
      previous: period(shiftDays(start, -1), new Date(start.getTime() - 1)),
    };
  }
  if (range === 'week' || range === 'last_week') {
    const thisWeek = startOfWeek(now);
    if (range === 'last_week') {
      const start = shiftDays(thisWeek, -7);
      const end = new Date(thisWeek.getTime() - 1);
      return {
        current: period(start, end),
        previous: period(shiftDays(start, -7), new Date(start.getTime() - 1)),
      };
    }
    const elapsed = now.getTime() - thisWeek.getTime();
    const previousStart = shiftDays(thisWeek, -7);
    return {
      current: period(thisWeek, now),
      previous: period(previousStart, new Date(previousStart.getTime() + elapsed)),
    };
  }
  if (range === 'month') {
    return mirroredPeriod(new Date(now.getFullYear(), now.getMonth(), 1), now);
  }
  if (range === 'year') {
    return mirroredPeriod(new Date(now.getFullYear(), 0, 1), now);
  }
  const match = /^(7|30|90)d$/.exec(range);
  if (!match) return null;
  const days = Number(match[1]);
  const end = startOfDay(now);
  const currentStart = shiftDays(end, -(days - 1));
  const previousEnd = new Date(currentStart.getTime() - 1);
  const elapsed = now.getTime() - currentStart.getTime();
  const previousStart = new Date(previousEnd.getTime() - elapsed);
  return {
    current: period(currentStart, now),
    previous: period(previousStart, previousEnd),
  };
}

function selected(value, filter) {
  if (!filter || (Array.isArray(filter) && filter.length === 0)) return true;
  return Array.isArray(filter) ? filter.includes(value) : value === filter;
}

function visitCells(container, filters, visitor) {
  for (const [sourceId, source] of Object.entries(container?.sources ?? {})) {
    if (!selected(sourceId, filters.source)) continue;
    for (const [key, bucket] of Object.entries(source.cells ?? {})) {
      const { model, project } = splitCellKey(key);
      if (!selected(model, filters.model) || !selected(project, filters.project)) continue;
      visitor({ source: sourceId, model, project, bucket });
    }
  }
}

function inPeriod(slotStart, bounds) {
  return slotStart >= bounds.fromTs && slotStart <= bounds.toTs;
}

function visitSlots(rollup, bounds, filters, visitor) {
  for (const [rawStart, slot] of Object.entries(rollup?.slots ?? {})) {
    const slotStart = Number(rawStart);
    if (!inPeriod(slotStart, bounds)) continue;
    visitCells(slot, filters, (cell) => visitor({ slotStart, ...cell }));
  }
}

function bucketForPeriod(rollup, bounds, filters) {
  const total = emptyBucket();
  visitSlots(rollup, bounds, filters, ({ bucket }) => mergeBucket(total, bucket));
  return total;
}

function publicTotals(bucket) {
  const reasoningTokens = bucket.reasoning;
  const nonCachedReadTokens = billable(bucket);
  return {
    inputTokens: bucket.input + bucket.write5m + bucket.write1h,
    outputTokens: Math.max(bucket.output - reasoningTokens, 0),
    reasoningTokens,
    cachedTokens: bucket.cacheRead,
    totalTokens: throughput(bucket),
    nonCachedReadTokens,
    // 兼容旧版原生面板；新客户端应使用语义准确的 nonCachedReadTokens。
    billableTokens: nonCachedReadTokens,
  };
}

function compare(current, previous) {
  const result = {};
  for (const key of Object.keys(current)) {
    result[key] = Number.isFinite(current[key]) && previous[key] > 0
      ? (current[key] - previous[key]) / previous[key]
      : null;
  }
  return result;
}

function dimensions(rollup) {
  const sources = new Set();
  const models = new Set();
  const projects = new Set();
  for (const day of Object.values(rollup?.days ?? {})) {
    visitCells(day, {}, ({ source, model, project }) => {
      sources.add(source); models.add(model); projects.add(project);
    });
  }
  return {
    sources: [...sources].sort(),
    models: [...models].sort(),
    projects: [...projects].sort(),
  };
}

function distributions(rollup, bounds, filters, priceBucket) {
  const maps = { tools: new Map(), models: new Map(), projects: new Map() };
  const add = (map, id, bucket, cost) => {
    const target = map.get(id) ?? { bucket: emptyBucket(), estimatedCost: 0, priced: false };
    mergeBucket(target.bucket, bucket);
    if (cost !== null && Number.isFinite(cost)) {
      target.estimatedCost += cost;
      target.priced = true;
    }
    map.set(id, target);
  };
  visitSlots(rollup, bounds, filters, ({ source, model, project, bucket }) => {
    const cost = priceBucket ? priceBucket(model, bucket) : null;
    add(maps.tools, source, bucket, cost);
    add(maps.models, model, bucket, cost);
    add(maps.projects, project, bucket, cost);
  });
  const rows = (map) => [...map.entries()]
    .map(([id, aggregate]) => ({
      id, ...publicTotals(aggregate.bucket),
      estimatedCost: aggregate.priced ? aggregate.estimatedCost : null,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.id.localeCompare(b.id));
  return {
    tools: rows(maps.tools),
    models: rows(maps.models),
    projects: rows(maps.projects),
  };
}

function slotRows(rollup, bounds, filters, priceBucket) {
  const rows = [];
  visitSlots(rollup, bounds, filters, ({ slotStart, source, model, project, bucket }) => {
    rows.push({
      slotStart, source, model, project, ...publicTotals(bucket),
      estimatedCost: priceBucket ? priceBucket(model, bucket) : null,
    });
  });
  return rows.sort((a, b) => b.slotStart - a.slotStart
    || a.source.localeCompare(b.source) || a.model.localeCompare(b.model)
    || a.project.localeCompare(b.project));
}

function rowCursor(row) {
  const raw = [row.slotStart, row.source, row.model, row.project].join('\0');
  return Buffer.from(raw).toString('base64url');
}

function heatmapDateContext(bounds) {
  const start = startOfDay(new Date(bounds.fromTs));
  const end = startOfDay(new Date(bounds.toTs));
  const utcDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayCount = Math.floor((utcDay(end) - utcDay(start)) / (24 * 60 * 60 * 1000)) + 1;
  if (dayCount <= 7) return null;

  const result = new Map();
  for (let weekday = 1; weekday <= 7; weekday++) {
    const first = shiftDays(start, (weekday - (((start.getDay() + 6) % 7) + 1) + 7) % 7);
    if (first > end) continue;
    const count = Math.floor((utcDay(end) - utcDay(first)) / (7 * 24 * 60 * 60 * 1000)) + 1;
    result.set(weekday, {
      dateStart: dayKey(first),
      dateEnd: dayKey(shiftDays(first, (count - 1) * 7)),
      dateCount: count,
    });
  }
  return result;
}

function heatmap(rows, sessions = [], bounds) {
  const cells = [];
  const dateContext = heatmapDateContext(bounds);
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ weekday, hour, inputTokens: 0, outputTokens: 0,
        reasoningTokens: 0, cachedTokens: 0, totalTokens: 0,
        nonCachedReadTokens: 0, billableTokens: 0,
        estimatedCost: null, activeSeconds: 0,
        ...(dateContext?.get(weekday) ?? {}) });
    }
  }
  for (const row of rows) {
    const date = new Date(row.slotStart);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const cell = cells[(weekday - 1) * 24 + date.getHours()];
    for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedTokens',
      'totalTokens', 'nonCachedReadTokens', 'billableTokens']) cell[key] += row[key];
    if (row.estimatedCost !== null) {
      cell.estimatedCost = (cell.estimatedCost ?? 0) + row.estimatedCost;
    }
  }
  for (const session of sessions) {
    const date = new Date(session.displayTs);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    cells[(weekday - 1) * 24 + date.getHours()].activeSeconds += session.activeSeconds ?? 0;
  }
  return cells;
}

function priceSummary(rollup, bounds, filters, priceBucket) {
  let estimated = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  const unpricedModels = new Set();
  visitSlots(rollup, bounds, filters, ({ model, bucket }) => {
    const tokens = throughput(bucket);
    const cost = priceBucket ? priceBucket(model, bucket) : null;
    if (cost === null || !Number.isFinite(cost)) {
      unpricedTokens += tokens;
      if (tokens > 0) unpricedModels.add(model);
    } else {
      estimated += cost;
      pricedTokens += tokens;
    }
  });
  const total = pricedTokens + unpricedTokens;
  return {
    estimated: priceBucket && pricedTokens > 0 ? estimated : null,
    coverage: total > 0 ? pricedTokens / total : 1,
    pricedTokens,
    unpricedTokens,
    unpricedModels: [...unpricedModels].sort(),
  };
}

function series(rollup, bounds, filters, priceBucket, sessions = []) {
  const buckets = new Map();
  const costs = new Map();
  const priced = new Set();
  visitSlots(rollup, bounds, filters, ({ slotStart, model, bucket }) => {
    const key = dayKey(new Date(slotStart));
    const total = buckets.get(key) ?? emptyBucket();
    mergeBucket(total, bucket);
    buckets.set(key, total);
    const cost = priceBucket ? priceBucket(model, bucket) : null;
    if (cost !== null && Number.isFinite(cost)) {
      costs.set(key, (costs.get(key) ?? 0) + cost);
      priced.add(key);
    }
  });
  const sessionDays = new Map();
  for (const session of sessions) {
    const key = dayKey(new Date(session.displayTs));
    const total = sessionDays.get(key) ?? { activeSeconds: 0, durationSeconds: 0 };
    total.activeSeconds += session.activeSeconds ?? 0;
    total.durationSeconds += session.durationSeconds ?? 0;
    sessionDays.set(key, total);
  }
  const points = [];
  for (let date = new Date(`${bounds.from}T00:00:00`); dayKey(date) <= bounds.to;
    date = shiftDays(date, 1)) {
    const key = dayKey(date);
    const bucket = buckets.get(key) ?? emptyBucket();
    points.push({
      day: key, ...publicTotals(bucket), estimatedCost: priced.has(key) ? costs.get(key) : null,
      activeSeconds: sessionDays.get(key)?.activeSeconds ?? 0,
      durationSeconds: sessionDays.get(key)?.durationSeconds ?? 0,
    });
  }
  return points;
}

function sessionsForPeriod(rollup, bounds, filters) {
  if (filters.model) return null;
  return Object.entries(rollup?.sessions ?? {})
    .filter(([source]) => selected(source, filters.source))
    .flatMap(([source, sessions]) => sessions.map((session) => ({ ...session, source })))
    .filter((session) => selected(session.project, filters.project))
    .filter((session) => session.lastTs >= bounds.fromTs && session.firstTs <= bounds.toTs)
    // Sessions are not divisible without raw events. Attribute the stored summary
    // to its first visible instant so totals, trend and heatmap remain consistent.
    .map((session) => ({ ...session, displayTs: Math.max(session.firstTs, bounds.fromTs) }));
}

function sessionSummary(sessions, filters) {
  if (filters.model) {
    return { available: false, reason: 'model-filter', totals: {
      sessions: 0, activeSeconds: 0, durationSeconds: 0, messageCount: 0, userMessageCount: 0,
    } };
  }
  const totals = summarizeSessions(sessions ?? []);
  return {
    available: true,
    totals: {
      sessions: totals.sessions,
      activeSeconds: totals.activeSeconds,
      durationSeconds: totals.durationSeconds,
      messageCount: totals.messageCount,
      userMessageCount: totals.userMessageCount,
    },
    userPromptHours: totals.userPromptHours,
  };
}

/**
 * Statistics interface shared by the native panel and the local web view.
 * Callers provide intent (range, filters, metric); all usage math stays here.
 */
export function queryUsageAnalytics(rollup, {
  range = '30d', now = new Date(), filters = {}, cursor = 0, limit = 50,
  priceBucket = null, from = null, to = null,
} = {}) {
  const bounds = relativeBounds(range, now, { from, to, rollup });
  if (!bounds) throw new Error(`不支持的分析区间: ${range}`);
  const totals = publicTotals(bucketForPeriod(rollup, bounds.current, filters));
  const cost = priceSummary(rollup, bounds.current, filters, priceBucket);
  const currentSessionList = sessionsForPeriod(rollup, bounds.current, filters);
  const sessions = sessionSummary(currentSessionList, filters);
  let previous = null;
  if (bounds.previous) {
    const previousTokens = publicTotals(bucketForPeriod(rollup, bounds.previous, filters));
    const previousCost = priceSummary(rollup, bounds.previous, filters, priceBucket);
    const previousSessions = sessionSummary(
      sessionsForPeriod(rollup, bounds.previous, filters), filters,
    );
    previous = {
      ...previousTokens,
      estimatedCost: previousCost.estimated,
      ...(previousSessions.available ? previousSessions.totals : {}),
    };
  }
  const currentComparable = {
    ...totals,
    estimatedCost: cost.estimated,
    ...(sessions.available ? sessions.totals : {}),
  };
  const allRows = slotRows(rollup, bounds.current, filters, priceBucket);
  const matchedCursor = typeof cursor === 'string'
    ? allRows.findIndex((row) => rowCursor(row) === cursor)
    : -1;
  const start = matchedCursor >= 0 ? matchedCursor + 1 : 0;
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
  const items = allRows.slice(start, start + pageSize);
  const collection = rollup?.collection ?? {
    complete: false, scannedAt: null, deferredFiles: null, sources: {},
  };
  return {
    empty: totals.totalTokens === 0 && (!sessions.available || sessions.totals.sessions === 0),
    range,
    filters,
    bounds,
    totals,
    previous,
    // 缺失文件对前后区间的影响通常不对称，不完整索引不能产出可信同比。
    comparison: collection.complete && previous ? compare(currentComparable, previous) : null,
    dimensions: dimensions(rollup),
    collection,
    cost,
    series: series(rollup, bounds.current, filters, priceBucket, currentSessionList ?? []),
    sessions,
    distributions: distributions(rollup, bounds.current, filters, priceBucket),
    heatmap: heatmap(allRows, currentSessionList ?? [], bounds.current),
    records: {
      items,
      total: allRows.length,
      nextCursor: start + pageSize < allRows.length ? rowCursor(items.at(-1)) : null,
    },
  };
}
