import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseline, buildRollup, cellKey, dayKeysInRange, localDayKey, summarize,
} from '../src/runtime/rollup.js';

/** 本地时区的某天某点，避免测试受运行机器时区影响。 */
function at(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function record(ts, overrides = {}) {
  return {
    source: 'claude-code',
    input: 100, output: 50, cacheRead: 900, write5m: 0, write1h: 0, reasoning: 0,
    model: 'claude-opus-5', project: 'Maclawd', ts,
    ...overrides,
  };
}

test('localDayKey 用本地时区归类', () => {
  assert.equal(localDayKey(at(2026, 7, 30, 23)), '2026-07-30');
  assert.equal(localDayKey(at(2026, 1, 5, 0)), '2026-01-05');
});

test('buildRollup 按日 / source 累加，模型×项目存成交叉单元', () => {
  const rollup = buildRollup([
    record(at(2026, 7, 30, 10)),
    record(at(2026, 7, 30, 10), { model: 'claude-sonnet-5' }),
    record(at(2026, 7, 29, 10), { project: 'other' }),
  ]);

  const day = rollup.days['2026-07-30'];
  assert.equal(day.sources['claude-code'].input, 200);
  const cells = day.sources['claude-code'].cells;
  assert.equal(Object.keys(cells).length, 2, '两个模型 × 一个项目 = 两个单元');
  assert.equal(cells[cellKey('claude-opus-5', 'Maclawd')].input, 100);
  assert.equal(cells[cellKey('claude-sonnet-5', 'Maclawd')].input, 100);
  assert.equal(
    rollup.days['2026-07-29'].sources['claude-code'].cells[cellKey('claude-opus-5', 'other')].input,
    100,
  );
});

test('summarize 支持模型 × 项目联动筛选', () => {
  const now = new Date(2026, 6, 30, 12);
  const rollup = buildRollup([
    record(at(2026, 7, 30, 10), { model: 'opus', project: 'A', input: 1, output: 0, cacheRead: 0 }),
    record(at(2026, 7, 30, 10), { model: 'opus', project: 'B', input: 10, output: 0, cacheRead: 0 }),
    record(at(2026, 7, 30, 10), { model: 'sonnet', project: 'A', input: 100, output: 0, cacheRead: 0 }),
    record(at(2026, 7, 30, 10), { model: 'sonnet', project: 'B', input: 1000, output: 0, cacheRead: 0 }),
  ]);

  assert.equal(summarize(rollup, 'today', { now }).billable, 1111, '不筛选取全量');
  assert.equal(summarize(rollup, 'today', { now, model: 'opus' }).billable, 11);
  assert.equal(summarize(rollup, 'today', { now, project: 'A' }).billable, 101);
  // 交叉：分维度存储做不到这一格
  assert.equal(summarize(rollup, 'today', { now, model: 'sonnet', project: 'B' }).billable, 1000);
});

test('筛选后作息图不可用，明确标记而不是给出错误分布', () => {
  const now = new Date(2026, 6, 30, 12);
  const rollup = buildRollup([record(at(2026, 7, 30, 10))]);
  assert.equal(summarize(rollup, 'today', { now }).hoursAvailable, true);
  assert.equal(summarize(rollup, 'today', { now, model: 'claude-opus-5' }).hoursAvailable, false);
});

test('buildRollup 的 hours 记录吞吐量并按本地小时归位', () => {
  const rollup = buildRollup([record(at(2026, 7, 30, 14))]);
  const hours = rollup.days['2026-07-30'].hours;
  assert.equal(hours.length, 24);
  assert.equal(hours[14], 1050, 'input+output+cacheRead');
  assert.equal(hours.reduce((a, b) => a + b, 0), 1050);
});

test('buildRollup 同时持久化稀疏的 30 分钟槽', () => {
  const first = at(2026, 7, 30, 14, 5);
  const second = at(2026, 7, 30, 14, 35);
  const rollup = buildRollup([
    record(first, { input: 10 }),
    record(second, { input: 20 }),
  ]);
  assert.deepEqual(Object.keys(rollup.slots).map(Number).sort(), [
    at(2026, 7, 30, 14, 0), at(2026, 7, 30, 14, 30),
  ]);
  assert.equal(Object.keys(
    rollup.slots[at(2026, 7, 30, 14, 0)].sources['claude-code'].cells,
  ).length, 1);
});

test('区间按周一为一周之始切分', () => {
  // 2026-07-30 是周四，本周一是 2026-07-27
  const now = new Date(2026, 6, 30, 12);
  const keys = [
    '2026-07-19', '2026-07-20', '2026-07-26',
    '2026-07-27', '2026-07-29', '2026-07-30',
  ];
  assert.deepEqual(dayKeysInRange(keys, 'today', now), ['2026-07-30']);
  assert.deepEqual(dayKeysInRange(keys, 'yesterday', now), ['2026-07-29']);
  assert.deepEqual(dayKeysInRange(keys, 'week', now), ['2026-07-27', '2026-07-29', '2026-07-30']);
  assert.deepEqual(dayKeysInRange(keys, 'last_week', now), ['2026-07-20', '2026-07-26']);
  assert.equal(dayKeysInRange(keys, 'all', now).length, 6);
});

test('summarize 同时给出两种口径与命中率', () => {
  const rollup = buildRollup([
    record(at(2026, 7, 30, 10)),
    record(at(2026, 7, 30, 11)),
  ]);
  const summary = summarize(rollup, 'today', { now: new Date(2026, 6, 30, 12) });
  assert.equal(summary.billable, 300, '(100+50) × 2');
  assert.equal(summary.throughput, 2100, '(100+50+900) × 2');
  assert.equal(summary.throughput - summary.billable, 1800, '差额就是缓存读');
  assert.equal(summary.hitRate, 1800 / 2000);
});

test('summarize 可以只看单一 source', () => {
  const rollup = buildRollup([
    record(at(2026, 7, 30, 10)),
    record(at(2026, 7, 30, 10), { source: 'workbuddy', input: 7, output: 3, cacheRead: 0 }),
  ]);
  const now = new Date(2026, 6, 30, 12);
  assert.equal(summarize(rollup, 'today', { now, source: 'workbuddy' }).billable, 10);
  assert.equal(summarize(rollup, 'today', { now }).billable, 160);
});

test('summarize 未知模型不猜价格，如实报告未计价 token', () => {
  const rollup = buildRollup([
    record(at(2026, 7, 30, 10), { model: 'claude-opus-5' }),
    record(at(2026, 7, 30, 10), { model: '某个没见过的模型' }),
  ]);
  const summary = summarize(rollup, 'today', {
    now: new Date(2026, 6, 30, 12),
    priceBucket: (model) => (model === 'claude-opus-5' ? 1.23 : null),
  });
  assert.equal(summary.cost, 1.23);
  assert.equal(summary.unpricedTokens, 1050);
});

test('baseline 取过去若干天有活动日的中位数，排除今天', () => {
  const now = new Date(2026, 6, 30, 12);
  const rollup = buildRollup([
    // 今天：必须被排除，否则「比平时」会自我参照
    record(at(2026, 7, 30, 10), { input: 999999 }),
    record(at(2026, 7, 29, 10), { input: 100, output: 0, cacheRead: 0 }),
    record(at(2026, 7, 28, 10), { input: 300, output: 0, cacheRead: 0 }),
    record(at(2026, 7, 27, 10), { input: 200, output: 0, cacheRead: 0 }),
  ]);
  assert.equal(baseline(rollup, { now }), 200, '100/200/300 的中位数');
});

test('baseline 没有历史时返回 null 而不是 0', () => {
  const rollup = buildRollup([record(at(2026, 7, 30, 10))]);
  assert.equal(baseline(rollup, { now: new Date(2026, 6, 30, 12) }), null);
});

test('buildRollup 持久化采集完整度，不能把未完成索引伪装成完整统计', () => {
  const collection = { complete: false, deferredFiles: 2, sources: { codex: { complete: false } } };
  const rollup = buildRollup([], {}, {}, collection);
  assert.deepEqual(rollup.collection, collection);
});
