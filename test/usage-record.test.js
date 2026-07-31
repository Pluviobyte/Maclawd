import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billable, cacheWrite, cacheWriteSplit, hitRate, pickCount,
  resolveInclusiveInput, throughput, toCount,
} from '../src/runtime/usage-record.js';

test('toCount 把负数/NaN/缺失归零', () => {
  assert.equal(toCount(5), 5);
  assert.equal(toCount(-3), 0);
  assert.equal(toCount(undefined), 0);
  assert.equal(toCount('12'), 12);
  assert.equal(toCount('abc'), 0);
});

test('pickCount 取第一个有值的别名', () => {
  assert.equal(pickCount({ b: 7 }, 'a', 'b'), 7);
  assert.equal(pickCount({ a: null, b: 7 }, 'a', 'b'), 7);
  assert.equal(pickCount({}, 'a'), 0);
});

test('cacheWriteSplit 无 TTL 拆分时全部记入 5m', () => {
  const split = cacheWriteSplit({ cache_creation_input_tokens: 100 });
  assert.deepEqual(split, { write5m: 100, write1h: 0 });
});

test('cacheWriteSplit 用 max 防止总量与拆分被重复计数', () => {
  // 总量与拆分一致：直接采用拆分，不相加成 200
  const consistent = cacheWriteSplit({
    cache_creation_input_tokens: 100,
    cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 },
  });
  assert.deepEqual(consistent, { write5m: 60, write1h: 40 });
  assert.equal(consistent.write5m + consistent.write1h, 100);
});

test('cacheWriteSplit 总量大于拆分时差额记入 5m 档', () => {
  const split = cacheWriteSplit({
    cache_creation_input_tokens: 100,
    cache_creation: { ephemeral_1h_input_tokens: 30 },
  });
  assert.deepEqual(split, { write5m: 70, write1h: 30 });
});

test('不变量 1：total == input + output 时 input 含缓存，必须减掉', () => {
  // 取自 ~/.workbuddy 真实记录
  const resolved = resolveInclusiveInput({
    input: 35908, output: 1990, cacheRead: 30848, cacheWrite: 0, total: 37898,
  });
  assert.equal(resolved.input, 5060);
  assert.equal(resolved.cacheRead, 30848);
  // 减掉之后三项互斥，加起来才等于原始 input
  assert.equal(resolved.input + resolved.cacheRead + resolved.cacheWrite, 35908);
});

test('不变量 1：total 不等于 input + output 时保持原样（Claude 口径）', () => {
  const resolved = resolveInclusiveInput({
    input: 100, output: 50, cacheRead: 900, cacheWrite: 20, total: 1070,
  });
  assert.equal(resolved.input, 100);
  assert.equal(resolved.cacheRead, 900);
  assert.equal(resolved.cacheWrite, 20);
});

test('不变量 1：缓存部分不能超过 input 本身', () => {
  const resolved = resolveInclusiveInput({
    input: 100, output: 10, cacheRead: 500, cacheWrite: 0, total: 110,
  });
  assert.equal(resolved.cacheRead, 100);
  assert.equal(resolved.input, 0);
});

test('billable 不含缓存读，throughput 含', () => {
  const record = {
    input: 1000, output: 500, cacheRead: 9000, write5m: 200, write1h: 100,
  };
  assert.equal(cacheWrite(record), 300);
  assert.equal(billable(record), 1800);
  assert.equal(throughput(record), 10800);
  // 两口径的差额恰好是缓存读
  assert.equal(throughput(record) - billable(record), record.cacheRead);
});

test('hitRate 的分母是全部输入 token', () => {
  const record = { input: 100, output: 999, cacheRead: 800, write5m: 100, write1h: 0 };
  assert.equal(hitRate(record), 800 / 1000);
});

test('hitRate 在没有输入时返回 0 而不是 NaN', () => {
  assert.equal(hitRate({ input: 0, output: 5, cacheRead: 0, write5m: 0, write1h: 0 }), 0);
});
