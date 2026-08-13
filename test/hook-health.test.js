import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAndRepair, createHealthState, MAX_REPAIR_ATTEMPTS } from '../src/runtime/hook-health.js';

/**
 * hook 自愈。
 *
 * 守的是一个**静默**失效点：settings.json 被别的工具覆盖之后我们的 hook
 * 条目就没了，桌宠从此永远停在 idle，而且不报错——「没有事件」和
 * 「一切正常但很闲」在我们这边长得一模一样。
 *
 * 同时守它的反面：hookEnhancement 开关是唯一的授权来源，关闭状态下
 * 看门狗一个字节都不能写——否则「撤回授权」会被当成故障修回去。
 * 所有用例显式注入 enabled，不让测试结果依赖本机的真实设置文件。
 */

const ALL = ['SessionStart', 'PreToolUse', 'Stop'];
const on = () => true;

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
    status: fakeStatus([[]]), repair: () => { repaired += 1; }, size: () => 100, enabled: on,
  });
  assert.equal(r.action, 'healthy');
  assert.equal(repaired, 0);
});

test('从来没装过 = 用户没开启，不是坏了', () => {
  // 自愈只负责「本来装着、后来掉了」。替用户做「开启」的决定不是它的事。
  const state = createHealthState();
  let repaired = 0;
  const r = checkAndRepair(state, {
    status: fakeStatus([ALL]), repair: () => { repaired += 1; }, size: () => 100, enabled: on,
  });
  assert.equal(r.action, 'healthy');
  assert.equal(r.detail, '未启用');
  assert.equal(repaired, 0, '没开启的功能不该被自动开启');
});

test('开关关闭时绝不修 —— 撤回授权必须真正生效', () => {
  // 曾经的 bug：用户关闭开关 → uninstallHooks 移除条目 → 看门狗只看文件，
  // 把「撤回授权」当成「被覆盖」，把 hook 原样装了回去。
  const state = createHealthState();
  state.everHealthy = true; // 开启期间它确实健康过
  state.lastSize = 100;
  let repaired = 0;
  const r = checkAndRepair(state, {
    status: fakeStatus([ALL]), // 条目全没了（刚被卸载）
    repair: () => { repaired += 1; },
    size: () => 100,
    enabled: () => false,
  });
  assert.equal(r.action, 'healthy');
  assert.equal(r.detail, '开关关闭');
  assert.equal(repaired, 0, '开关关闭后任何缺失都不是看门狗的事');
});

test('开关关闭会清掉看门狗的记忆，重新开启后从头观察', () => {
  const state = createHealthState();
  state.everHealthy = true;
  state.lastSize = 4000;
  state.attempts = 2;
  state.signature = 'PreToolUse';

  checkAndRepair(state, {
    status: fakeStatus([ALL]), repair: () => {}, size: () => 100, enabled: () => false,
  });
  assert.equal(state.everHealthy, false, '关闭期间的健康史不该带进下一次开启');
  assert.equal(state.lastSize, 0, '旧文件大小基线会让 shrink 护栏误判');
  assert.equal(state.attempts, 0);
  assert.equal(state.signature, null);

  // 重新开启但服务端还没装：看门狗保持手不动（未启用语义），
  // 安装是 server 的开关处理路径的事。
  let repaired = 0;
  const r = checkAndRepair(state, {
    status: fakeStatus([ALL]), repair: () => { repaired += 1; }, size: () => 100, enabled: on,
  });
  assert.equal(r.action, 'healthy');
  assert.equal(r.detail, '未启用');
  assert.equal(repaired, 0);
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
    enabled: on,
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
    enabled: on,
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
    enabled: on,
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
  const stuck = {
    status: fakeStatus([['PreToolUse']]), repair: () => { repaired += 1; }, size: () => 100, enabled: on,
  };
  for (let i = 0; i < MAX_REPAIR_ATTEMPTS + 1; i += 1) checkAndRepair(state, stuck);
  assert.equal(checkAndRepair(state, stuck).action, 'manual');

  // 换一个缺失集合 = 换了一类问题，值得再试
  const different = {
    status: fakeStatus([['Stop'], []]), repair: () => { repaired += 1; }, size: () => 100, enabled: on,
  };
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
    enabled: on,
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
    enabled: on,
  });
  assert.equal(r.action, 'failed');
  assert.match(r.detail, /仍然缺/);
});
