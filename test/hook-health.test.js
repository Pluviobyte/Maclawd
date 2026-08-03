import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAndRepair, createHealthState, MAX_REPAIR_ATTEMPTS } from '../src/runtime/hook-health.js';

/**
 * hook 自愈。
 *
 * 守的是一个**静默**失效点：settings.json 被别的工具覆盖之后我们的 hook
 * 条目就没了，桌宠从此永远停在 idle，而且不报错——「没有事件」和
 * 「一切正常但很闲」在我们这边长得一模一样。
 */

const ALL = ['SessionStart', 'PreToolUse', 'Stop'];

/** 一个可控的 hookStatus 替身。 */
function fakeStatus(missingSeq) {
  let i = 0;
  return () => {
    const missing = missingSeq[Math.min(i++, missingSeq.length - 1)];
    return { installed: ALL.filter((e) => !missing.includes(e)), missing, path: '/x', script: '/y' };
  };
}

test('一切正常时什么都不做', () => {
  const state = createHealthState();
  state.everHealthy = true;
  let repaired = 0;
  const r = checkAndRepair(state, {
    status: fakeStatus([[]]), repair: () => { repaired += 1; }, size: () => 100,
  });
  assert.equal(r.action, 'healthy');
  assert.equal(repaired, 0);
});

test('从来没装过 = 用户没开启，不是坏了', () => {
  // 自愈只负责「本来装着、后来掉了」。替用户做「开启」的决定不是它的事。
  const state = createHealthState();
  let repaired = 0;
  const r = checkAndRepair(state, {
    status: fakeStatus([ALL]), repair: () => { repaired += 1; }, size: () => 100,
  });
  assert.equal(r.action, 'healthy');
  assert.equal(r.detail, '未启用');
  assert.equal(repaired, 0, '没开启的功能不该被自动开启');
});

test('装过之后掉了 → 补回去', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 100;
  let repaired = 0;
  // 第一次查缺 PreToolUse，修完之后第二次查是好的
  const r = checkAndRepair(state, {
    status: fakeStatus([['PreToolUse'], []]),
    repair: () => { repaired += 1; },
    size: () => 100,
  });
  assert.equal(r.action, 'repaired');
  assert.equal(repaired, 1);
});

test('文件突然变小就不修 —— 别覆盖别人正在写的东西', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 4000;
  let repaired = 0;
  const r = checkAndRepair(state, {
    status: fakeStatus([['PreToolUse']]),
    repair: () => { repaired += 1; },
    size: () => 200, // 从 4000 掉到 200：多半是别的工具正写到一半
  });
  assert.equal(r.action, 'skipped-shrink');
  assert.equal(repaired, 0, '宁可这轮不修，也不能把第三方 hook 覆盖掉');
});

test('同一类失败修够次数就停手，不无限重试', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 100;
  let repaired = 0;
  const opts = {
    // 永远缺同一个：修了也没用
    status: fakeStatus([['PreToolUse']]),
    repair: () => { repaired += 1; },
    size: () => 100,
  };
  const results = [];
  for (let i = 0; i < MAX_REPAIR_ATTEMPTS + 2; i += 1) {
    results.push(checkAndRepair(state, opts).action);
  }
  assert.equal(repaired, MAX_REPAIR_ATTEMPTS, `只该修 ${MAX_REPAIR_ATTEMPTS} 次`);
  assert.equal(results.at(-1), 'manual', '放弃之后要明确标成需要人工处理');
});

test('问题性质变了就重新开始计数', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 100;
  let repaired = 0;
  // 先让它对 PreToolUse 放弃
  const stuck = { status: fakeStatus([['PreToolUse']]), repair: () => { repaired += 1; }, size: () => 100 };
  for (let i = 0; i < MAX_REPAIR_ATTEMPTS + 1; i += 1) checkAndRepair(state, stuck);
  assert.equal(checkAndRepair(state, stuck).action, 'manual');

  // 换一个缺失集合 = 换了一类问题，值得再试
  const different = { status: fakeStatus([['Stop'], []]), repair: () => { repaired += 1; }, size: () => 100 };
  assert.equal(checkAndRepair(state, different).action, 'repaired',
    '新的问题不该被上一个问题的放弃状态连坐');
});

test('修的过程抛异常不会把服务带下去', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 100;
  const r = checkAndRepair(state, {
    status: fakeStatus([['PreToolUse']]),
    repair: () => { throw new Error('settings.json 只读'); },
    size: () => 100,
  });
  assert.equal(r.action, 'failed');
  assert.match(r.detail, /只读/);
});

test('修完仍然缺 → 报失败，不谎称修好了', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 100;
  const r = checkAndRepair(state, {
    // 修完再查还是缺
    status: fakeStatus([['PreToolUse'], ['PreToolUse']]),
    repair: () => {},
    size: () => 100,
  });
  assert.equal(r.action, 'failed');
  assert.match(r.detail, /仍然缺/);
});
