import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateEngine } from '../src/runtime/state-engine.js';

/**
 * Stop 不等于回合结束。
 *
 * 这组测试守的是一个用户每天都在踩的问题：`/goal` 装的是 Stop hook，
 * 它否决停止之后 Claude 继续跑，而我们照旧把 Stop 当成「干完了」——
 * 于是一个任务里桌宠会 working → idle + 欢呼 → working 好几轮，
 * **为一件没做完的事欢呼**。后台 Bash（run_in_background）同理。
 */

const SEC = 1000;

/** 走到一个明确的 working 上，作为每个用例的起点。 */
function working(now = 0) {
  const e = createStateEngine();
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, now);
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, now + SEC);
  assert.equal(e.tick(now + 2 * SEC).actionId, 'working');
  return e;
}

test('stop_hook_active 时按住 working，不回 idle 也不欢呼', () => {
  const e = working();
  e.observeEvent({
    type: 'Stop', sessionId: 's', disposition: 'complete', stopHookActive: true,
  }, 3 * SEC);
  const at = e.tick(3 * SEC + 10);
  assert.equal(at.actionId, 'working', `被 Stop hook 否决的停止不该回 idle，实际 ${at.actionId}`);
  // 关键：不能欢呼。事情还没做完。
  assert.notEqual(at.actionId, 'success');
  // 一直按住，不会自己兑现——hook 否决了停止，就是明确知道还有活。
  assert.equal(e.tick(60 * SEC).actionId, 'working');
});

test('session_crons 挂着时同样按住', () => {
  const e = working();
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'complete', sessionCrons: 1 }, 3 * SEC);
  assert.equal(e.tick(3 * SEC + 10).actionId, 'working');
  assert.equal(e.tick(30 * SEC).actionId, 'working');
});

test('后台任务在跑且模型还没说完话 → 按住', () => {
  const e = working();
  e.observeEvent({
    type: 'Stop', sessionId: 's', disposition: 'inconclusive', backgroundTasks: 2,
  }, 3 * SEC);
  assert.equal(e.tick(3 * SEC + 10).actionId, 'working');
  assert.equal(e.tick(30 * SEC).actionId, 'working');
});

test('后台任务在跑但模型已经说完 → 去抖后照常兑现', () => {
  const e = working();
  e.observeEvent({
    type: 'Stop', sessionId: 's', disposition: 'complete', backgroundTasks: 1,
  }, 3 * SEC);
  // 窗口内：按住
  assert.equal(e.tick(3 * SEC + 500).actionId, 'working', '安静窗口内不该已经收尾');
  // 窗口过完：该欢呼的照样欢呼，只是迟了 2 秒
  assert.equal(e.tick(3 * SEC + 2100).actionId, 'success', '窗口过完应当兑现庆祝');
});

test('去抖窗口内来了前进事件 → 取消兑现，不会突然打回 idle', () => {
  const e = working();
  e.observeEvent({
    type: 'Stop', sessionId: 's', disposition: 'complete', backgroundTasks: 1,
  }, 3 * SEC);
  // 窗口还没过完，模型继续调工具了
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Edit' }, 3 * SEC + 800);
  // 远远超过窗口，那个被取消的 Stop 不该再冒出来
  const later = e.tick(20 * SEC);
  assert.equal(later.actionId, 'working', `被取消的 Stop 又兑现了：${later.actionId}`);
});

test('普通的 Stop 行为不变：回 idle 并庆祝', () => {
  const e = working();
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'complete' }, 3 * SEC);
  assert.equal(e.tick(3 * SEC + 10).actionId, 'success', '正常收尾还是要欢呼');
});

test('被打断的 Stop 行为不变：安静回 idle', () => {
  const e = working();
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'inconclusive' }, 3 * SEC);
  const at = e.tick(3 * SEC + 10);
  assert.ok(at.actionId.startsWith('idle'), `打断后应安静回 idle，实际 ${at.actionId}`);
});

test('按住期间久战计时不被清零', () => {
  // 按住不该重置 stateSince：否则一个反复触发 Stop hook 的长任务
  // 永远升不到 working.long，「它是不是卡了」那条信息就没了。
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, 0);
  for (let i = 1; i <= 4; i++) {
    e.observeEvent({ type: 'Stop', sessionId: 's', stopHookActive: true }, i * 60 * SEC);
  }
  assert.equal(e.tick(4 * 60 * SEC + SEC).actionId, 'working.long',
    '连续被否决的停止不该把久战计时清零');
});
