import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricingRefresher, PRICE_MAX_AGE_MS, PRICE_RETRY_MS } from '../src/runtime/pricing-refresh.js';

function fixture({ fresh = false, update } = {}) {
  let time = Date.parse('2026-09-15T12:00:00Z');
  let info = fresh ? { models: 1, fetchedAt: new Date(time).toISOString() } : {};
  let calls = 0;
  const prices = new Set();
  const manager = createPricingRefresher({
    now: () => time, meta: () => info, lookup: (model) => prices.has(model),
    update: async (options) => {
      calls++;
      if (update) await update(options);
      info = { models: 1, fetchedAt: new Date(time).toISOString() };
      return { count: 1 };
    },
  });
  return { manager, prices, get calls() { return calls; }, advance: (ms) => { time += ms; } };
}

test('startup refreshes missing tables, skips fresh ones, then refreshes after 24 hours', async () => {
  for (const fresh of [false, true]) {
    const f = fixture({ fresh });
    try {
      f.manager.start();
      await f.manager.check();
      assert.equal(f.calls, fresh ? 0 : 1);
      f.advance(PRICE_MAX_AGE_MS);
      await f.manager.check();
      assert.equal(f.calls, fresh ? 1 : 2);
    } finally { f.manager.stop(); }
  }
});

test('unpriced models trigger background refresh; persistent misses are throttled globally', async () => {
  const f = fixture({ fresh: true });
  try {
    f.manager.start();
    for (const model of ['unknown', '', '<synthetic>', 'codex-auto-review']) f.manager.observe(model);
    await f.manager.check();
    assert.equal(f.calls, 0);
    f.manager.observe('gpt-6-astra');
    await f.manager.check();
    assert.equal(f.calls, 1);
    f.manager.observe('another-new-model');
    await f.manager.check();
    assert.equal(f.calls, 1);
    f.advance(PRICE_RETRY_MS);
    await f.manager.check();
    assert.equal(f.calls, 2);
    f.prices.add('gpt-6-astra');
    f.prices.add('another-new-model');
    f.advance(PRICE_RETRY_MS);
    await f.manager.check();
    assert.equal(f.calls, 2);
  } finally { f.manager.stop(); }
});

test('background failures back off; manual update bypasses cooldown and reports errors', async () => {
  const f = fixture({ update: async () => { throw new Error('offline'); } });
  try {
    f.manager.start();
    await f.manager.check();
    assert.equal(f.calls, 1);
    await f.manager.check();
    assert.equal(f.calls, 1);
    f.advance(PRICE_RETRY_MS);
    await f.manager.check();
    assert.equal(f.calls, 2);
    await assert.rejects(f.manager.refresh(), /offline/);
    assert.equal(f.calls, 3);
  } finally { f.manager.stop(); }
});

test('manual and automatic refresh share one in-flight request; shutdown cancels it', async () => {
  let signal;
  let release;
  const f = fixture({ update: (options) => {
    signal = options.signal;
    return new Promise((resolve) => { release = resolve; });
  } });
  f.manager.start();
  await Promise.resolve();
  const first = f.manager.refresh();
  const second = f.manager.refresh();
  assert.equal(first, second);
  assert.equal(f.calls, 1);
  f.manager.stop();
  assert.equal(signal.aborted, true);
  release();
  await first;
  f.manager.observe('new-model');
  f.advance(PRICE_MAX_AGE_MS);
  await f.manager.check();
  assert.equal(f.calls, 1);
});
