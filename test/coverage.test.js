import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, createCoverage, GLIMPSE_MS } from '../src/runtime/coverage.js';

/**
 * 覆盖记录守的是一件测试守不住的事：**这个动作在真实使用中被看见过吗**。
 * 所以这组测试重点验两个容易写错、写错了结论就完全反过来的地方：
 * 当前正在显示的那一次要算进去；只闪一下的要和从没出现过区分开。
 */

test('结算的是上一个动作的时长，不是新动作的', () => {
  const c = createCoverage();
  c.observe('idle', 0);
  c.observe('working', 5000);
  const snap = c.snapshot(5000);
  assert.equal(snap.actions.idle.totalMs, 5000, 'idle 显示了 5 秒');
  assert.equal(snap.actions.idle.count, 1);
});

test('当前正在显示的那一次也要计入快照', () => {
  // 不算的话，一个已经显示了两小时的动作在报告里会是 0 次——
  // 而那恰恰是最该被看到的数据。
  const c = createCoverage();
  c.observe('working', 0);
  const snap = c.snapshot(2 * 3600_000);
  assert.equal(snap.actions.working.count, 1);
  assert.equal(snap.actions.working.totalMs, 2 * 3600_000);
});

test('快照不能改动内部状态——多次取值必须一致', () => {
  const c = createCoverage();
  c.observe('working', 0);
  const a = c.snapshot(10_000);
  const b = c.snapshot(10_000);
  assert.deepEqual(a, b, '取一次快照就把当前这次结算掉了，第二次会翻倍');
});

test('只闪一下和从没出现过必须分开', () => {
  // 「出现过但每次都短得看不清」是这个项目实际踩过的坑：
  // 工具几毫秒就返回，工作修饰一闪而过，肉眼根本抓不住——
  // 从可达性上看它完全正常，从体验上看它等于不存在。
  const c = createCoverage();
  c.observe('a', 0);
  c.observe('b', 100); // a 只显示了 100ms
  c.observe('a', 100 + 5000); // b 显示了 5 秒
  const known = ['a', 'b', 'c'];
  const { never, glimpsed, normal } = classify(c.snapshot(100 + 5000), known);

  assert.deepEqual(never.map((r) => r.id), ['c'], 'c 从没出现过');
  assert.deepEqual(glimpsed.map((r) => r.id), ['a'], 'a 每次都只闪一下');
  assert.deepEqual(normal.map((r) => r.id), ['b']);
});

test('闪过一次但也正常显示过，算正常', () => {
  // 判据是**最长的那一次**，不是平均：只要有一次被看清了，这个动作就不算隐形。
  const c = createCoverage();
  c.observe('x', 0);
  c.observe('y', 50); // x 闪了 50ms
  c.observe('x', 1000);
  c.observe('y', 1000 + 3000); // x 又显示了 3 秒
  const { glimpsed, normal } = classify(c.snapshot(4000), ['x', 'y']);
  assert.deepEqual(glimpsed.map((r) => r.id), [], 'x 有一次显示够久，不该算隐形');
  assert.ok(normal.some((r) => r.id === 'x'));
  assert.equal(normal.find((r) => r.id === 'x').glimpses, 1, '但那次一闪而过要记下来');
});

test('同一个动作重复出现要累加而不是覆盖', () => {
  const c = createCoverage();
  for (let i = 0; i < 3; i++) {
    c.observe('idle', i * 2000);
    c.observe('working', i * 2000 + 1000);
  }
  const snap = c.snapshot(6000);
  assert.equal(snap.actions.idle.count, 3);
  assert.equal(snap.actions.idle.totalMs, 3000, '每次 1 秒，三次');
});

test('重复上报同一个动作不算新的一次', () => {
  // 引擎每 2 秒 tick 一遍，同一个动作会被反复报告。
  // 每次都当成新的一次露面的话，计数会变成「刷新了多少次」而不是「出现了几次」。
  const c = createCoverage();
  c.observe('working', 0);
  c.observe('working', 2000);
  c.observe('working', 4000);
  assert.equal(c.snapshot(6000).actions.working.count, 1);
});

test('能从落盘的数据恢复，跨重启累计', () => {
  const first = createCoverage();
  first.observe('idle', 0);
  first.observe('working', 3000);
  const saved = first.snapshot(3000);

  const second = createCoverage(saved);
  second.observe('idle', 0);
  second.observe('working', 1000);
  const snap = second.snapshot(1000);
  assert.equal(snap.actions.idle.count, 2, '重启前后各一次');
  assert.equal(snap.actions.idle.totalMs, 4000);
});

test('隐形门槛与文档一致', () => {
  // 这个数会被写进报告文案，改了它而不改文案会让报告开始骗人
  assert.equal(GLIMPSE_MS, 900);
});
