import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 状态切换的延迟。
 *
 * 用户报的现象是「状态切换延迟很严重」。实测下来引擎内部换状态只要 2ms，
 * **延迟 100% 在传递方式上**：外壳每 2 秒拉一次，所以看到的是 0～2000ms
 * （平均 1 秒）。点一下桌宠等一秒才动，读起来就是卡——不是动画慢，
 * 是消息还没送到。
 *
 * 拉模式下只能靠加密轮询来降，代价是空闲时也在空转。长轮询把方向反过来：
 * 请求挂在服务端等，状态一变立刻返回。又快又省。
 */

function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-latency-'));
  const before = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = dir;
  return (async () => {
    const { serve } = await import('../src/runtime/server.js?case=latency');
    const started = await serve({ port: 0 });
    const base = `http://127.0.0.1:${started.port}`;
    try {
      return await fn(base);
    } finally {
      started.worker.stop?.();
      await new Promise((r) => started.server.close(r));
      if (before === undefined) delete process.env.MACLAWD_DATA_DIR;
      else process.env.MACLAWD_DATA_DIR = before;
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

const get = async (url) => (await fetch(url)).json();
const post = async (url, body) => (await fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();

test('/api/state 带 version，用来做长轮询的游标', () => withServer(async (base) => {
  const snapshot = await get(`${base}/api/state`);
  assert.equal(typeof snapshot.version, 'number');
}));

test('不带 since 时行为不变：立刻返回', () => withServer(async (base) => {
  // 面板、测试、curl 都还是这条路，不能因为加了长轮询就被挂住。
  const t0 = Date.now();
  await get(`${base}/api/state`);
  assert.ok(Date.now() - t0 < 500, '不带 since 不该进入等待');
}));

test('版本已经领先时立刻返回，不空等', () => withServer(async (base) => {
  const first = await get(`${base}/api/state`);
  await post(`${base}/api/event`, { type: 'PreToolUse', sessionId: 's', toolName: 'Read' });
  const t0 = Date.now();
  // 拿一个过时的游标去问：服务端应当发现「你已经落后了」，马上给新的
  const next = await get(`${base}/api/state?since=${Math.max(0, first.version - 1)}`);
  assert.ok(Date.now() - t0 < 500, `落后的游标不该等待，实际等了 ${Date.now() - t0}ms`);
  assert.ok(next.version >= first.version);
}));

test('挂着等的请求会在状态变化时被立刻唤醒', () => withServer(async (base) => {
  const first = await get(`${base}/api/state`);
  const t0 = Date.now();
  const pending = get(`${base}/api/state?since=${first.version}`);
  await new Promise((r) => setTimeout(r, 120));
  await post(`${base}/api/event`, { type: 'PermissionRequest', sessionId: 's' });
  const woken = await pending;

  assert.ok(woken.version > first.version, '版本必须往前走，否则下一轮会立刻空转');
  // 送达要快。原来这里是 0～2000ms（外壳 2 秒一轮）。
  assert.ok(Date.now() - t0 < 800, `状态送达用了 ${Date.now() - t0}ms`);
}));

test('跟着游标一路等下去，最终一定能等到那次变化', () => withServer(async (base) => {
  // 长轮询的语义是「**任何**一次变化都唤醒」，不是「等我关心的那次」。
  // 引擎自己也在动（idle 变体轮换、自发行为、一次性动作到期），
  // 所以先醒来的完全可能是别的变化——真实客户端就是拿新游标接着等。
  // 这条测试模拟的正是那个循环。
  let version = (await get(`${base}/api/state`)).version;
  await post(`${base}/api/event`, { type: 'PermissionRequest', sessionId: 's' });

  const deadline = Date.now() + 5000;
  let seen = null;
  while (Date.now() < deadline) {
    const next = await get(`${base}/api/state?since=${version}`);
    version = next.version;
    if (next.state.actionId === 'needs_owner') { seen = next; break; }
  }
  assert.ok(seen, '跟着游标等下去应当能看到 needs_owner');
}));

test('投事件的响应体就是新画面 —— 交互反馈不用等下一轮', () => withServer(async (base) => {
  // 「点一下桌宠要等一秒才动」就是因为外壳把这个响应丢掉了。
  const reply = await post(`${base}/api/event`, { type: 'shell.click' });
  assert.equal(reply.state.actionId, 'interaction.click');
  assert.ok(reply.plan?.source, '响应里必须带得起渲染的素材');
  assert.equal(typeof reply.version, 'number');
}));

test('画面没变时版本不动 —— 否则长轮询等于退化成忙轮询', () => withServer(async (base) => {
  const a = await get(`${base}/api/state`);
  await new Promise((r) => setTimeout(r, 400));   // 服务端自己 tick 了好几拍
  const b = await get(`${base}/api/state`);
  assert.equal(b.version, a.version,
    '同一个画面连续 tick 不该产生新版本，否则外壳会被无意义地唤醒');
}));

test('服务端自己推进时钟 —— 没人来问也会到期', () => withServer(async (base) => {
  // 一次性动作播完要自己回落。以前引擎只在**有人来问**的时候才 tick，
  // 于是这类「没有外部事件也该发生」的转场被外壳的轮询节奏卡着。
  await post(`${base}/api/event`, { type: 'shell.click' });
  const during = await get(`${base}/api/state`);
  assert.equal(during.state.actionId, 'interaction.click');
  // 完全不去问它，等一次性动作自然到期
  await new Promise((r) => setTimeout(r, 3400));
  const after = await get(`${base}/api/state`);
  assert.notEqual(after.state.actionId, 'interaction.click',
    '一次性动作应当自己到期回落，不需要外部来 tick');
}));
