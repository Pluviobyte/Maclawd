import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 额度存储。测试重点是**新鲜度**，不是加减法。
 *
 * 窗口按墙钟重置，与用不用无关。一条 resetAt 已经过去的记录会一直显示
 * 重置前的高位——那不是「旧数据」，那是**假数据**，比空着更糟。
 */

const DATA = mkdtempSync(join(tmpdir(), 'maclawd-quota-'));
process.env.MACLAWD_DATA_DIR = DATA;

const {
  recordQuota, readQuota, clearQuota, pendingAlerts, markAlerted, freshness,
  QUIET_AFTER_MS, CODEX_QUIET_AFTER_MS, DROP_AFTER_RESET_MS,
} = await import('../src/runtime/account-quota.js');

after(() => rmSync(DATA, { recursive: true, force: true }));
beforeEach(() => clearQuota());

const T0 = 1_785_000_000_000;
const HOUR = 3600_000;

/** 2026-08-03 从本机真实抓到的 payload 里摘出来的那部分，不是编的。 */
const REAL = {
  source: 'claude-code',
  windows: {
    five_hour: { usedPercent: 15, resetAt: 1_785_746_400_000 },
    seven_day: { usedPercent: 3, resetAt: 1_786_287_600_000 },
  },
  context: { usedPercent: 4, windowSize: 1_000_000 },
  sessionCostUsd: 0.353807,
  model: 'claude-opus-4-6[1m]',
};
const REAL_NOW = 1_785_746_400_000 - 54 * 60 * 1000; // 抓到时距 5h 重置还有 54 分钟

test('真实 payload 存得进、读得出', () => {
  recordQuota(REAL, { now: REAL_NOW });
  const snap = readQuota({ now: REAL_NOW });

  assert.equal(snap.empty, false);
  assert.equal(snap.sources.length, 1);
  const src = snap.sources[0];
  assert.equal(src.id, 'claude-code');
  assert.equal(src.label, 'Claude Code');
  assert.equal(src.context.usedPercent, 4);
  assert.equal(src.context.windowSize, 1_000_000);
  assert.equal(src.model, 'claude-opus-4-6[1m]');

  const five = src.windows.find((w) => w.id === 'five_hour');
  assert.equal(five.usedPercent, 15);
  assert.equal(five.state, 'live');
  assert.equal(five.label, '5 小时');
});

test('短窗口排在长窗口前面——它才是「现在能不能开大活」那个', () => {
  recordQuota(REAL, { now: REAL_NOW });
  const ids = readQuota({ now: REAL_NOW }).sources[0].windows.map((w) => w.id);
  assert.deepEqual(ids, ['five_hour', 'seven_day']);
});

test('WorkBuddy 积分桶保留已用、总额、剩余与类型供首页精确展示', () => {
  recordQuota({
    source: 'workbuddy',
    sourceLabel: 'WorkBuddy',
    completeSnapshot: true,
    windows: {
      base_1: {
        label: '基础体验包', kind: 'base', used: 253.62, limit: 500,
        remaining: 246.38, usedPercent: 50.724, resetAt: T0 + 30 * 24 * HOUR,
      },
      bonus_1: {
        label: '活动赠送包', kind: 'bonus', used: 10, limit: 100,
        remaining: 90, usedPercent: 10, resetAt: T0 + 60 * 24 * HOUR,
      },
    },
  }, { now: T0 });

  const source = readQuota({ now: T0 }).sources.find((item) => item.id === 'workbuddy');
  assert.equal(source.label, 'WorkBuddy');
  assert.deepEqual(source.windows.map((window) => window.id), ['base_1', 'bonus_1']);
  assert.deepEqual(source.windows[0], {
    id: 'base_1', label: '基础体验包', kind: 'base', used: 253.62, limit: 500,
    remaining: 246.38, usedPercent: 50.724, resetAt: T0 + 30 * 24 * HOUR,
    state: 'live', updatedAt: T0, lastSeenAt: T0, staleSeconds: 0,
  });
});

test('额度窗口重置后不再暴露重置前的精确积分', () => {
  recordQuota({
    source: 'workbuddy', completeSnapshot: true,
    windows: {
      base_1: {
        label: '基础包', kind: 'base', usedPercent: 25,
        used: 25, limit: 100, remaining: 75, resetAt: T0 + 1_000,
      },
    },
  }, { now: T0 });
  const window = readQuota({ now: T0 + 1_001 }).sources[0].windows[0];
  assert.equal(window.state, 'reset');
  assert.equal(window.usedPercent, null);
  assert.equal(window.used, null);
  assert.equal(window.limit, null);
  assert.equal(window.remaining, null);
});

// ---------- 新鲜度 ----------

test('超过 5 分钟没确认 → quiet，并给出过了多久', () => {
  recordQuota(REAL, { now: REAL_NOW });
  const later = REAL_NOW + QUIET_AFTER_MS + 60_000;
  const five = readQuota({ now: later }).sources[0].windows.find((w) => w.id === 'five_hour');

  assert.equal(five.state, 'quiet');
  assert.ok(five.staleSeconds >= 360);
});

test('Codex 十分钟缓存期内保持 live，超过缓存期才 quiet', () => {
  recordQuota({
    source: 'codex',
    windows: { seven_day: { usedPercent: 51, resetAt: T0 + 7 * 24 * HOUR } },
  }, { now: T0 });

  assert.equal(readQuota({ now: T0 + QUIET_AFTER_MS + 60_000 })
    .sources[0].windows[0].state, 'live');
  assert.equal(readQuota({ now: T0 + CODEX_QUIET_AFTER_MS + 1 })
    .sources[0].windows[0].state, 'quiet');
});

test('过了重置时刻 → reset，且**不再给百分比**', () => {
  recordQuota(REAL, { now: REAL_NOW });
  const after = 1_785_746_400_000 + 60_000;
  const five = readQuota({ now: after }).sources[0].windows.find((w) => w.id === 'five_hour');

  assert.equal(five.state, 'reset');
  assert.equal(five.usedPercent, null,
    '重置前的 15% 在重置后是假的，继续显示就是撒谎');
});

test('重置超过 48 小时还没有新报告 → 记录直接丢弃', () => {
  recordQuota(REAL, { now: REAL_NOW });
  const long = 1_785_746_400_000 + DROP_AFTER_RESET_MS + HOUR;
  const snap = readQuota({ now: long });
  const five = snap.sources[0]?.windows.find((w) => w.id === 'five_hour');
  assert.equal(five, undefined);
});

test('freshness 是纯函数，判据可以单独验', () => {
  assert.equal(freshness({ resetAt: T0 + HOUR, lastSeenAt: T0 }, T0), 'live');
  assert.equal(freshness({ resetAt: T0 + HOUR, lastSeenAt: T0 - 10 * 60_000 }, T0), 'quiet');
  assert.equal(freshness({ resetAt: T0 - 1, lastSeenAt: T0 }, T0), 'reset');
});

// ---------- updatedAt / lastSeenAt 必须分开 ----------

test('数值没变时 updatedAt 不动，但 lastSeenAt 要动', () => {
  recordQuota(REAL, { now: T0 });
  const first = readQuota({ now: T0 }).sources[0].windows[0];

  recordQuota(REAL, { now: T0 + 60_000 });
  const second = readQuota({ now: T0 + 60_000 }).sources[0].windows[0];

  assert.equal(second.updatedAt, first.updatedAt,
    '只记 updatedAt 的话，一个稳定不变的额度会被误判成失联');
  assert.equal(second.lastSeenAt, T0 + 60_000);
});

test('数值变了 updatedAt 才跟着动', () => {
  recordQuota(REAL, { now: T0 });
  const bumped = { ...REAL, windows: { ...REAL.windows, five_hour: { usedPercent: 42, resetAt: REAL.windows.five_hour.resetAt } } };
  recordQuota(bumped, { now: T0 + 60_000 });

  const five = readQuota({ now: T0 + 60_000 }).sources[0].windows[0];
  assert.equal(five.usedPercent, 42);
  assert.equal(five.updatedAt, T0 + 60_000);
});

// ---------- 部分上报 ----------

test('上报只带一个窗口时，另一个保留旧值而不是被清空', () => {
  recordQuota(REAL, { now: T0 });
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 20, resetAt: REAL.windows.five_hour.resetAt } },
  }, { now: T0 + 1000 });

  const windows = readQuota({ now: T0 + 1000 }).sources[0].windows;
  assert.equal(windows.find((w) => w.id === 'five_hour').usedPercent, 20);
  assert.equal(windows.find((w) => w.id === 'seven_day').usedPercent, 3,
    '清空会让面板在两次刷新之间闪一下空白');
});

test('第一条 payload 没有 rate_limits 是正常路径，不是错误', () => {
  // 实测：会话第一条只有 context/cost，没有额度
  const result = recordQuota({
    source: 'claude-code',
    windows: {},
    context: { usedPercent: null, windowSize: 1_000_000 },
    sessionCostUsd: 0,
  }, { now: T0 });
  assert.ok(result, '不该抛，也不该返回 null');
});

test('context.usedPercent 是 null 时整块不落盘——null 当 0 会显示假的「0%」', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 10, resetAt: T0 + HOUR } },
    context: { usedPercent: null, windowSize: 1_000_000 },
  }, { now: T0 });

  assert.equal(readQuota({ now: T0 }).sources[0].context, null);
});

test('百分比被夹在 0–100', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 999, resetAt: T0 + HOUR } },
  }, { now: T0 });
  assert.equal(readQuota({ now: T0 }).sources[0].windows[0].usedPercent, 100);
});

// ---------- 提醒去重 ----------

test('达到阈值才提醒', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 80, resetAt: T0 + HOUR } },
  }, { now: T0 });

  assert.equal(pendingAlerts({ threshold: 85, now: T0 }).length, 0);
  assert.equal(pendingAlerts({ threshold: 75, now: T0 }).length, 1);
});

test('同一个周期内只提醒一次', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 90, resetAt: T0 + HOUR } },
  }, { now: T0 });

  const first = pendingAlerts({ threshold: 85, now: T0 });
  assert.equal(first.length, 1);
  markAlerted(first, { now: T0 });

  assert.equal(pendingAlerts({ threshold: 85, now: T0 + 60_000 }).length, 0);
});

test('**窗口重置后，下一个周期重新可提醒**', () => {
  // 这条是「按 resetAt 去重而不是按天去重」的全部理由：
  // 5 小时窗口一天有好几个周期，按天去重会漏掉后面几个。
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 90, resetAt: T0 + HOUR } },
  }, { now: T0 });
  markAlerted(pendingAlerts({ threshold: 85, now: T0 }), { now: T0 });

  // 新周期：resetAt 换了一个
  const next = T0 + 2 * HOUR;
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 91, resetAt: next + 5 * HOUR } },
  }, { now: next });

  const again = pendingAlerts({ threshold: 85, now: next });
  assert.equal(again.length, 1, '同一天的第二个 5 小时周期必须能再提醒一次');
});

test('已重置的窗口不提醒', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 95, resetAt: T0 + HOUR } },
  }, { now: T0 });

  assert.equal(pendingAlerts({ threshold: 85, now: T0 + 2 * HOUR }).length, 0);
});

test('提醒里带着足够拼出文案的信息', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 88, resetAt: T0 + HOUR } },
  }, { now: T0 });

  const [alert] = pendingAlerts({ threshold: 85, now: T0 });
  assert.equal(alert.sourceLabel, 'Claude Code');
  assert.equal(alert.windowLabel, '5 小时');
  assert.equal(alert.usedPercent, 88);
  assert.equal(alert.resetAt, T0 + HOUR);
});

// ---------- 杂项 ----------

test('没有任何数据时是明确的 empty，不是一个空壳来源', () => {
  const snap = readQuota({ now: T0 });
  assert.equal(snap.empty, true);
  assert.deepEqual(snap.sources, []);
});

test('垃圾上报被忽略而不是崩掉', () => {
  assert.equal(recordQuota(null), null);
  assert.equal(recordQuota('nope'), null);
  assert.equal(readQuota({ now: T0 }).empty, true);
});

test('未知窗口名被丢弃，不污染存储', () => {
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 10, resetAt: T0 + HOUR }, made_up: { usedPercent: 50 } },
  }, { now: T0 });
  const ids = readQuota({ now: T0 }).sources[0].windows.map((w) => w.id);
  assert.deepEqual(ids, ['five_hour']);
});
