import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateEngine } from '../src/runtime/state-engine.js';

/**
 * 「现在这个状态是谁发起的」。
 *
 * 桌宠亮着 needs_owner 却没法一键过去，等于只提醒不解决。
 * hook 把发起进程的 pid 送过来，引擎按会话记住，外壳沿父进程链
 * 找到宿主终端并激活——这组测试守的是中间那一段。
 */

const SEC = 1000;

test('工作中的会话带着它的 pid 与 cwd', () => {
  const e = createStateEngine();
  e.observeEvent({
    type: 'PreToolUse', sessionId: 'a', toolName: 'Read', pid: 4242, cwd: '/work/proj',
  }, 0);
  const focus = e.tick(SEC).focus;
  assert.deepEqual(focus, { pid: 4242, cwd: '/work/proj' });
});

test('赢家换人时 focus 跟着换', () => {
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read', pid: 111 }, 0);
  // b 要人决定，优先级更高，应当抢过去
  e.observeEvent({ type: 'PermissionRequest', sessionId: 'b', pid: 222 }, SEC);
  const at = e.tick(2 * SEC);
  assert.equal(at.actionId, 'needs_owner');
  assert.equal(at.focus.pid, 222, '跳过去的应当是正在等你回答的那个会话');
});

test('静默链与自发行为没有 focus', () => {
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read', pid: 111 }, 0);
  e.observeEvent({ type: 'Stop', sessionId: 'a', disposition: 'inconclusive' }, SEC);
  // 走到睡着——这时画面不属于任何终端，点它不该把你甩到某个窗口去
  const asleep = e.tick(10 * 60 * SEC);
  assert.equal(asleep.actionId, 'sleeping');
  assert.equal(asleep.focus, null, '睡眠链不该带 focus');
});

test('没送 pid 的事件不会伪造一个', () => {
  // 面板手动触发、旧版写入器都不会带 pid。这时必须是 null，
  // 不能退回上一个会话的 pid——那会把你甩到一个不相干的窗口。
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read' }, 0);
  assert.equal(e.tick(SEC).focus, null);
});

test('同一会话换了终端时取最新的 pid', () => {
  // tmux attach 到别的终端之后，能跳过去的是新的那个。
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read', pid: 111 }, 0);
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Edit', pid: 999 }, SEC);
  assert.equal(e.tick(2 * SEC).focus.pid, 999);
});

test('tick 返回的快照带 busy —— 并发分档靠它', () => {
  // 这条是回归测试：tick() 曾经直接抛出内部对象，少了 busy，
  // 而服务端正是拿 state.busy 去挑分档的，于是分档一次都没生效过。
  const e = createStateEngine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read' }, 0);
  e.observeEvent({ type: 'PreToolUse', sessionId: 'b', toolName: 'Read' }, 0);
  const at = e.tick(SEC);
  assert.equal(typeof at.busy, 'number', 'tick 的返回值必须带 busy');
  assert.equal(at.busy, 2);
});
