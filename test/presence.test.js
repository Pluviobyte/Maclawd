import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateEngine } from '../src/runtime/state-engine.js';

/**
 * 存在感知：状态机的第二根轴。
 *
 * 睡眠链此前只有一根轴——「agent 沉默了多久」。那是个错误的依据：
 * 你读代码、写文档、开会的时候 agent 全都是沉默的，而人一直在；
 * 反过来 agent 跑长任务时你完全可以去泡咖啡。用一个推另一个永远错一半。
 *
 * 现在的规则：**agent 静下来了并且人也不在，才开始往睡里走。**
 */

const SEC = 1000;
const MIN = 60 * SEC;

/** 睡眠链的四段。人还在的时候，这四个一个都不该出现。 */
const SLEEP_CHAIN = new Set(['drowsing', 'away', 'collapsing', 'sleeping']);

/**
 * 断言「没有往睡里走」。
 *
 * 不能简单断言 actionId 是 idle：真正空闲时引擎会偶尔插播自发行为
 * （溜达、探头看一眼），那正是「人在旁边、宠物闲着」该有的样子。
 */
function assertAwake(actionId, message) {
  assert.ok(!SLEEP_CHAIN.has(actionId), `${message}，实际 ${actionId}`);
}

/** 让引擎有过一次活动（睡眠链要求 lastActivityAt > 0 才启动）。 */
function started(now = 0) {
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, now);
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'inconclusive' }, now + SEC);
  return e;
}

test('人一直在 → 永远停在 idle，不进睡眠链', () => {
  const e = started();
  // 每分钟动一次鼠标，连续 20 分钟
  for (let t = 2 * MIN; t <= 20 * MIN; t += MIN) {
    e.observeEvent({ type: 'shell.presence' }, t);
    assertAwake(e.tick(t + SEC).actionId, `人还在的时候不该往睡里走（第 ${t / MIN} 分钟）`);
  }
});

test('人走了 → 完整走完 idle → away → sleeping', () => {
  const e = started();
  e.observeEvent({ type: 'shell.presence' }, 2 * MIN);
  // 之后再没有任何存在信号
  assertAwake(e.tick(3 * MIN).actionId, '刚走开时还不应进入睡眠链');
  assert.equal(e.tick(2 * MIN + 5 * MIN + SEC).actionId, 'away', '五分钟后该进 away');
  assert.equal(e.tick(2 * MIN + 6 * MIN + SEC).actionId, 'sleeping', '再过一分钟该睡着');
});

test('睡着后人回来 → 插播 waking，不是直接跳回 idle', () => {
  const e = started();
  e.observeEvent({ type: 'shell.presence' }, MIN);
  assert.equal(e.tick(MIN + 7 * MIN).actionId, 'sleeping');
  // 人回到座位，第一件事往往是动鼠标——这是 waking 在真实使用里最稳的触发源
  e.observeEvent({ type: 'shell.presence' }, MIN + 8 * MIN);
  assert.equal(e.current().actionId, 'waking', '人回来应当伸个懒腰醒过来');
});

test('人不在但 agent 在跑 → 照常显示工作，不睡', () => {
  const e = createStateEngine();
  // 一个长任务：每 30 秒一个事件，人全程没碰过鼠标
  for (let t = 0; t <= 15 * MIN; t += 30 * SEC) {
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash' }, t);
  }
  const at = e.tick(15 * MIN + SEC);
  assert.ok(at.actionId.startsWith('working'),
    `agent 在跑就该显示工作，与人在不在无关，实际 ${at.actionId}`);
});

test('人在终端里打字（鼠标没动）也算存在', () => {
  const e = started();
  // 只有 UserPromptSubmit，一次鼠标都没动——纯键盘用户不该被判成离开
  for (let t = 2 * MIN; t <= 20 * MIN; t += 3 * MIN) {
    e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, t);
    e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'inconclusive' }, t + SEC);
    assertAwake(e.tick(t + 2 * SEC).actionId, `键盘用户不该被判成离开（第 ${t / MIN} 分钟）`);
  }
});

test('从来没有存在信号时，行为与加这根轴之前一致', () => {
  // 向后兼容：外壳不支持 / 纯引擎测试的场景，presenceAt 恒为 0，
  // max(quietSince, 0) === quietSince，链条按老规矩走。
  const e = started();
  assert.equal(e.tick(SEC + 5 * MIN + SEC).actionId, 'away');
  assert.equal(e.tick(SEC + 6 * MIN + SEC).actionId, 'sleeping');
});

test('存在信号不污染 agent 的活动时钟', () => {
  // presenceAt 与 lastActivityAt 必须分开记。混在一起的话，
  // 「为什么它还在演工作」就没法解释了——人动鼠标不代表 agent 有动静。
  const e = started();
  const before = e.debug().lastActivityAt;
  e.observeEvent({ type: 'shell.presence' }, 10 * MIN);
  const after = e.debug();
  assert.equal(after.lastActivityAt, before, '存在信号不该更新 agent 活动时钟');
  assert.equal(after.presenceAt, 10 * MIN, '存在时钟该更新');
});
