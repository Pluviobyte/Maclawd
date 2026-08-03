import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryUsageAnalytics } from '../src/runtime/analytics.js';
import { buildRollup } from '../src/runtime/rollup.js';

function at(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function record(ts, overrides = {}) {
  return {
    source: 'codex', model: 'gpt-test', project: 'Maclawd', ts,
    input: 100, output: 50, reasoning: 20,
    cacheRead: 900, write5m: 30, write1h: 10,
    ...overrides,
  };
}

test('30D 分析同时返回完整 Token 口径和上一等长周期同比', () => {
  const now = new Date(2026, 7, 3, 12);
  const rollup = buildRollup([
    // 当前 30 天
    record(at(2026, 8, 2, 10)),
    record(at(2026, 7, 20, 10), { input: 200, cacheRead: 800 }),
    // 上一个 30 天
    record(at(2026, 6, 20, 10), { input: 50, output: 25, reasoning: 5,
      cacheRead: 400, write5m: 10, write1h: 0 }),
  ]);

  const result = queryUsageAnalytics(rollup, { range: '30d', now });

  assert.deepEqual(result.totals, {
    inputTokens: 380,
    outputTokens: 60,
    reasoningTokens: 40,
    cachedTokens: 1700,
    totalTokens: 2180,
    nonCachedReadTokens: 480,
    billableTokens: 480,
  });
  assert.equal(result.previous.totalTokens, 485);
  assert.equal(result.comparison.totalTokens, (2180 - 485) / 485);
  assert.equal(result.comparison.inputTokens, (380 - 60) / 60);
  assert.equal(result.bounds.current.toTs - result.bounds.current.fromTs,
    result.bounds.previous.toTs - result.bounds.previous.fromTs,
    '上一周期必须与当前已过去的时间严格等长');
});

test('筛选会同时作用于总量、7×24 热力图、分布与 30 分钟明细', () => {
  const now = new Date(2026, 7, 3, 12);
  const rollup = buildRollup([
    record(at(2026, 8, 3, 10, 5), { source: 'codex', model: 'gpt-a', project: 'A', input: 11 }),
    record(at(2026, 8, 3, 10, 35), { source: 'codex', model: 'gpt-a', project: 'A', input: 13 }),
    record(at(2026, 8, 3, 11, 5), { source: 'codex', model: 'gpt-b', project: 'B', input: 1000 }),
    record(at(2026, 8, 2, 9), { source: 'claude-code', model: 'claude-a', project: 'A', input: 2000 }),
  ]);

  const result = queryUsageAnalytics(rollup, {
    range: '7d', now,
    filters: { source: 'codex', model: 'gpt-a', project: 'A' },
    limit: 1,
  });

  assert.equal(result.totals.inputTokens, 104, '(11+40) + (13+40)');
  assert.deepEqual(result.dimensions.sources, ['claude-code', 'codex']);
  assert.deepEqual(result.distributions.tools.map((x) => x.id), ['codex']);
  assert.deepEqual(result.distributions.models.map((x) => x.id), ['gpt-a']);
  assert.deepEqual(result.distributions.projects.map((x) => x.id), ['A']);
  assert.equal(result.heatmap.length, 168);
  const monday10 = result.heatmap.find((x) => x.weekday === 1 && x.hour === 10);
  assert.equal(monday10.totalTokens, 2004);
  assert.equal(result.records.items.length, 1);
  assert.equal(result.records.items[0].slotStart, at(2026, 8, 3, 10, 30));
  assert.equal(typeof result.records.nextCursor, 'string');

  const updatedRollup = buildRollup([
    record(at(2026, 8, 3, 11, 35), { source: 'codex', model: 'gpt-a', project: 'A', input: 17 }),
    record(at(2026, 8, 3, 10, 5), { source: 'codex', model: 'gpt-a', project: 'A', input: 11 }),
    record(at(2026, 8, 3, 10, 35), { source: 'codex', model: 'gpt-a', project: 'A', input: 13 }),
  ]);
  const page2 = queryUsageAnalytics(updatedRollup, {
    range: '7d', now,
    filters: { source: 'codex', model: 'gpt-a', project: 'A' },
    limit: 1, cursor: result.records.nextCursor,
  });
  assert.equal(page2.records.items[0].slotStart, at(2026, 8, 3, 10, 0));
  assert.equal(page2.records.items[0].inputTokens, 51);
  assert.equal(page2.records.nextCursor, null);
});

test('费用、覆盖率、每日趋势与会话指标由同一查询统一计算', () => {
  const now = new Date(2026, 7, 3, 12);
  const sessions = {
    codex: [{
      firstTs: at(2026, 8, 3, 10), lastTs: at(2026, 8, 3, 11),
      activeSeconds: 120, durationSeconds: 3600, messageCount: 10,
      userMessageCount: 2, userPromptHours: new Array(24).fill(0), project: 'A',
    }],
  };
  const rollup = buildRollup([
    record(at(2026, 8, 3, 10), { model: 'priced', project: 'A', input: 10 }),
    record(at(2026, 8, 2, 10), { model: 'unknown-new', project: 'B', input: 90 }),
  ], sessions);

  const result = queryUsageAnalytics(rollup, {
    range: '7d', now,
    priceBucket: (model, bucket) => model === 'priced' ? bucket.input / 10 : null,
  });

  assert.equal(result.cost.estimated, 1);
  assert.equal(result.cost.unpricedTokens, 1080);
  assert.equal(result.cost.coverage, 1000 / 2080);
  assert.equal(result.sessions.available, true);
  assert.deepEqual(result.sessions.totals, {
    sessions: 1, activeSeconds: 120, durationSeconds: 3600,
    messageCount: 10, userMessageCount: 2,
  });
  assert.equal(result.series.length, 7);
  const today = result.series.find((x) => x.day === '2026-08-03');
  assert.equal(today.totalTokens, 1000);
  assert.equal(today.activeSeconds, 120);
  assert.equal(today.durationSeconds, 3600);
  assert.equal(result.heatmap.find((x) => x.weekday === 1 && x.hour === 10).activeSeconds, 120);
  assert.equal(result.distributions.tools.find((x) => x.id === 'codex').estimatedCost, 1);
  assert.equal(result.distributions.projects.find((x) => x.id === 'A').estimatedCost, 1);

  const byModel = queryUsageAnalytics(rollup, {
    range: '7d', now, filters: { model: 'priced' },
  });
  assert.equal(byModel.sessions.available, false, '会话没有模型归属，不能编造筛选结果');
  assert.equal(byModel.series.reduce((sum, point) => sum + point.activeSeconds, 0), 0);

  const unpricedOnly = queryUsageAnalytics(rollup, {
    range: '7d', now, filters: { model: 'unknown-new' }, priceBucket: () => null,
  });
  assert.equal(unpricedOnly.cost.estimated, null, '完全未计价不能伪装成 $0');
});

test('费用与会话也提供上一等长周期对比，24H 使用前后各 48 个半小时槽', () => {
  const now = new Date(2026, 7, 3, 12);
  const rollup = buildRollup([
    record(at(2026, 8, 3, 10), { model: 'priced', input: 20 }),
    record(at(2026, 7, 3, 10), { model: 'priced', input: 10 }),
  ], { codex: [
    { firstTs: at(2026, 8, 3, 9), lastTs: at(2026, 8, 3, 10), activeSeconds: 200,
      durationSeconds: 3600, messageCount: 8, userMessageCount: 2, project: 'Maclawd' },
    { firstTs: at(2026, 7, 3, 9), lastTs: at(2026, 7, 3, 10), activeSeconds: 100,
      durationSeconds: 3600, messageCount: 4, userMessageCount: 1, project: 'Maclawd' },
    { firstTs: at(2026, 8, 2, 10), lastTs: at(2026, 8, 2, 11), activeSeconds: 999,
      durationSeconds: 3600, messageCount: 99, userMessageCount: 9, project: 'Maclawd' },
  ] });
  const priceBucket = (_model, bucket) => bucket.input / 10;

  const month = queryUsageAnalytics(rollup, { range: '30d', now, priceBucket });
  assert.equal(month.previous.estimatedCost, 1);
  assert.equal(month.previous.activeSeconds, 100);
  assert.equal(month.comparison.estimatedCost, 1);
  assert.equal(month.comparison.activeSeconds, (1199 - 100) / 100);

  const last24h = queryUsageAnalytics(rollup, { range: '24h', now, priceBucket });
  assert.equal(last24h.sessions.totals.activeSeconds, 200,
    '昨天 10:00–11:00 的会话结束于 48 槽窗口之前，不能被整日边界误收');
  assert.equal(last24h.bounds.current.toTs - last24h.bounds.current.fromTs,
    last24h.bounds.previous.toTs - last24h.bounds.previous.fromTs,
    'Token 按等量槽比较时，会话的毫秒窗口也必须等长');
});

test('今天、24H、90D、自定义与全部区间使用明确边界', () => {
  const now = new Date(2026, 7, 3, 12);
  const rollup = buildRollup([
    record(at(2026, 8, 3, 11), { input: 1, output: 0, reasoning: 0, cacheRead: 0, write5m: 0, write1h: 0 }),
    record(at(2026, 8, 2, 12, 5), { input: 10, output: 0, reasoning: 0, cacheRead: 0, write5m: 0, write1h: 0 }),
    record(at(2026, 8, 2, 11, 50), { input: 100, output: 0, reasoning: 0, cacheRead: 0, write5m: 0, write1h: 0 }),
    record(at(2026, 8, 1, 10), { input: 1000, output: 0, reasoning: 0, cacheRead: 0, write5m: 0, write1h: 0 }),
    record(at(2026, 4, 1, 10), { input: 10000, output: 0, reasoning: 0, cacheRead: 0, write5m: 0, write1h: 0 }),
  ]);

  assert.equal(queryUsageAnalytics(rollup, { range: 'today', now }).totals.totalTokens, 1);
  assert.equal(queryUsageAnalytics(rollup, { range: '24h', now }).totals.totalTokens, 1,
    '24H 包含当前槽在内的最近 48 槽，不把第 49 个边界槽整桶误收');
  assert.equal(queryUsageAnalytics(rollup, { range: '90d', now }).totals.totalTokens, 1111);
  assert.equal(queryUsageAnalytics(rollup, { range: 'yesterday', now }).totals.totalTokens, 110);
  assert.equal(queryUsageAnalytics(rollup, { range: 'week', now }).totals.totalTokens, 1);
  assert.equal(queryUsageAnalytics(rollup, { range: 'last_week', now }).totals.totalTokens, 1110);
  assert.equal(queryUsageAnalytics(rollup, { range: 'month', now }).totals.totalTokens, 1111);
  assert.equal(queryUsageAnalytics(rollup, { range: 'year', now }).totals.totalTokens, 11111);
  assert.equal(queryUsageAnalytics(rollup, {
    range: 'custom', now, from: '2026-08-01', to: '2026-08-02',
  }).totals.totalTokens, 1110);
  const all = queryUsageAnalytics(rollup, { range: 'all', now });
  assert.equal(all.totals.totalTokens, 11111);
  assert.equal(all.previous, null);
  assert.equal(all.comparison, null);

  const marchEnd = queryUsageAnalytics(rollup, {
    range: 'month', now: new Date(2026, 2, 31, 12),
  });
  assert.ok(marchEnd.bounds.previous.toTs < marchEnd.bounds.current.fromTs,
    '上一个月度比较区间不能因 setMonth 溢出而与本月重叠');
  assert.equal(marchEnd.bounds.current.toTs - marchEnd.bounds.current.fromTs,
    marchEnd.bounds.previous.toTs - marchEnd.bounds.previous.fromTs);
});

test('筛选后没有 Token 与会话时返回明确空态', () => {
  const rollup = buildRollup([]);
  const result = queryUsageAnalytics(rollup, { range: '30d', now: new Date(2026, 7, 3, 12) });
  assert.equal(result.empty, true);
  assert.equal(result.totals.totalTokens, 0);
});

test('分析接口区分价格覆盖率与来源采集完整度', () => {
  const collection = {
    complete: false,
    scannedAt: '2026-08-03T12:00:00.000Z',
    deferredFiles: 3,
    sources: {
      codex: { discoveredFiles: 10, indexedFiles: 7, deferredFiles: 3,
        failedFiles: 0, complete: false, latestRecordAt: 1234 },
    },
  };
  const rollup = buildRollup([], {}, {}, collection);
  const result = queryUsageAnalytics(rollup, {
    range: '30d', now: new Date(2026, 7, 3, 12), priceBucket: () => 0,
  });
  assert.deepEqual(result.collection, collection);
  assert.equal(result.collection.complete, false);
  assert.equal(result.empty, true, '尚未索引到记录时仍是数据空态，但 UI 必须结合 collection');
  assert.equal(result.comparison, null, '部分索引不能发布精确同比');
  assert.equal(result.cost.coverage, 1, '无 Token 时价格覆盖率仍独立为 100%');
});
