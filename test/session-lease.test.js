import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 会话租约：桌宠没开 ≠ 这段时间的事全丢。
 *
 * hook 的 POST 连不上时是静默丢弃的（那条 catch 刻意如此——桌宠没开
 * 不该在用户的 agent 里留下错误）。代价是「先开 Claude Code 后开 Maclawd」
 * 和「我们自己重新打包重启一次」都会让在跑的会话凭空消失。
 * 租约写在磁盘上，不依赖服务在线。
 */

function withDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-lease-'));
  const before = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = dir;
  return (async () => {
    try {
      return await fn(dir);
    } finally {
      if (before === undefined) delete process.env.MACLAWD_DATA_DIR;
      else process.env.MACLAWD_DATA_DIR = before;
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

test('写一份租约再读回来', () => withDataDir(async () => {
  const m = await import('../src/runtime/session-lease.js?case=roundtrip');
  m.writeLease({ sessionId: 'abc', state: 'working', pid: process.pid, cwd: '/work' });
  const back = m.readLeases();
  assert.equal(back.length, 1);
  assert.equal(back[0].state, 'working');
  assert.equal(back[0].cwd, '/work');
}));

test('只有持续态才留租约', () => withDataDir(async () => {
  const m = await import('../src/runtime/session-lease.js?case=sustained');
  // idle 恢复没有意义（引擎本来就从 idle 起步）；
  // needs_owner 属于 agent 那一次运行里的对话框，复活它会指着一个
  // 可能已经被回答过的问题。
  assert.equal(m.writeLease({ sessionId: 'a', state: 'idle' }), null);
  assert.equal(m.writeLease({ sessionId: 'b', state: 'needs_owner' }), null);
  assert.equal(m.readLeases().length, 0);
}));

test('过期的租约读不回来，而且会被清掉', () => withDataDir(async () => {
  const m = await import('../src/runtime/session-lease.js?case=expired');
  m.writeLease({ sessionId: 'old', state: 'working', now: Date.now() - 60 * 60_000 });
  assert.equal(m.readLeases().length, 0, '一小时前的租约不该复活');
  assert.equal(readdirSync(m.leaseDir()).length, 0, '过期租约应当被顺手清掉');
}));

test('进程已经没了的租约不复活', () => withDataDir(async () => {
  const m = await import('../src/runtime/session-lease.js?case=dead');
  m.writeLease({ sessionId: 'ghost', state: 'working', pid: 999_999 });
  assert.equal(m.readLeases().length, 0, 'pid 已经不存在的会话不该被恢复');
}));

test('SessionEnd 撤租约', () => withDataDir(async () => {
  const m = await import('../src/runtime/session-lease.js?case=drop');
  m.writeLease({ sessionId: 'x', state: 'working', pid: process.pid });
  assert.equal(m.readLeases().length, 1);
  m.dropLease('x');
  assert.equal(m.readLeases().length, 0);
}));

test('损坏的租约文件不会让恢复整个失败', () => withDataDir(async () => {
  const m = await import('../src/runtime/session-lease.js?case=corrupt');
  m.writeLease({ sessionId: 'good', state: 'working', pid: process.pid });
  mkdirSync(m.leaseDir(), { recursive: true });
  writeFileSync(join(m.leaseDir(), 'broken.json'), '{ 这不是 JSON', 'utf8');
  const back = m.readLeases();
  assert.equal(back.length, 1, '坏文件应当被跳过，好的照常恢复');
  assert.equal(back[0].sessionId, 'good');
}));

test('会话 id 里的路径字符不会逃出租约目录', () => withDataDir(async (dir) => {
  const m = await import('../src/runtime/session-lease.js?case=traversal');
  m.writeLease({ sessionId: '../../../etc/passwd', state: 'working', pid: process.pid });
  const files = readdirSync(m.leaseDir());
  assert.equal(files.length, 1, '应当就地编码成一个普通文件名');
  assert.ok(!files[0].includes('/'), `文件名里不该有路径分隔符：${files[0]}`);
  // 数据目录之外一个文件都不该多出来
  assert.deepEqual(readdirSync(dir), ['session-leases']);
}));

test('恢复后引擎直接进入在途状态，而不是从 idle 开始', () => withDataDir(async () => {
  const { createStateEngine } = await import('../src/runtime/state-engine.js?case=restore');
  const now = 10 * 60_000;
  const e = createStateEngine();
  const n = e.restore([
    { sessionId: 's', state: 'working.testing', at: now - 30_000, pid: process.pid, cwd: '/w' },
  ], now);
  assert.equal(n, 1);
  const at = e.tick(now);
  assert.equal(at.actionId, 'working.testing', '重启后应当接着演在跑的那个任务');
  assert.equal(at.focus.pid, process.pid, '发起方也要一起恢复，否则点它跳不过去');
}));

test('恢复用租约里的时刻，不是"现在"', () => withDataDir(async () => {
  // 一份 8 分钟前写的租约，恢复后只剩 2 分钟就撞上 10 分钟的活跃态兜底线，
  // 而不是从头再算 10 分钟——那等于让一个早就结束的任务多演八分钟。
  const { createStateEngine } = await import('../src/runtime/state-engine.js?case=age');
  const now = 60 * 60_000;
  const e = createStateEngine();
  e.restore([{ sessionId: 's', state: 'working', at: now - 8 * 60_000 }], now);
  assert.ok(e.tick(now).actionId.startsWith('working'), '八分钟前的租约还在有效期内');
  assert.ok(e.tick(now + 90_000).actionId.startsWith('working'), '再过 1.5 分钟仍在线内');
  assert.ok(!e.tick(now + 3 * 60_000).actionId.startsWith('working'),
    '按租约时刻计龄的话，再过 3 分钟就该过期了');
}));

test('比引擎兜底线还旧的租约，恢复后立刻过期', () => withDataDir(async () => {
  // 租约有效期 15 分钟、活跃态兜底 10 分钟，中间那 5 分钟的租约会被
  // 读回来又马上丢掉。这是**对的**——它证明计龄用的是租约里的时刻。
  const { createStateEngine } = await import('../src/runtime/state-engine.js?case=tooold');
  const now = 60 * 60_000;
  const e = createStateEngine();
  e.restore([{ sessionId: 's', state: 'working', at: now - 12 * 60_000 }], now);
  assert.ok(!e.tick(now).actionId.startsWith('working'),
    '十二分钟前的工作态不该被复活');
}));

test('拉起 app：已经在跑就不重复拉', () => withDataDir(async () => {
  const m = await import('../src/runtime/auto-start.js?case=running');
  let launched = 0;
  const r = m.autoStart({
    running: () => true, bundle: () => '/Applications/Maclawd.app', launch: () => { launched += 1; },
  });
  assert.equal(r, 'running');
  assert.equal(launched, 0);
}));

test('拉起 app：源码目录里没有可拉起的东西就静默跳过', () => withDataDir(async () => {
  const m = await import('../src/runtime/auto-start.js?case=nobundle');
  let launched = 0;
  const r = m.autoStart({ running: () => false, bundle: () => null, launch: () => { launched += 1; } });
  assert.equal(r, 'no-bundle');
  assert.equal(launched, 0, '不该去猜一个不存在的路径');
}));

test('拉起 app：没在跑且有包时才真的拉', () => withDataDir(async () => {
  const m = await import('../src/runtime/auto-start.js?case=launch');
  const seen = [];
  const r = m.autoStart({
    running: () => false,
    bundle: () => '/Applications/Maclawd.app',
    launch: (app) => seen.push(app),
  });
  assert.equal(r, 'launched');
  assert.deepEqual(seen, ['/Applications/Maclawd.app']);
}));

test('拉起 app：关掉开关就一步都不做', () => withDataDir(async () => {
  const m = await import('../src/runtime/auto-start.js?case=disabled');
  let probed = false;
  const r = m.autoStart({ enabled: false, running: () => { probed = true; return false; } });
  assert.equal(r, 'disabled');
  assert.equal(probed, false, '关掉之后连探测都不该发生');
}));

test('拉起 app：用户主动退出后不被新会话复活', () => withDataDir(async (dir) => {
  writeFileSync(join(dir, 'auto-start-suppressed'), '', 'utf8');
  const autoStartModule = await import('../src/runtime/auto-start.js?case=user-quit');
  let launched = 0;
  let probed = 0;
  const result = autoStartModule.autoStart({
    running: () => { probed += 1; return false; },
    bundle: () => { probed += 1; return '/Applications/Maclawd.app'; },
    launch: () => { launched += 1; },
  });
  assert.equal(result, 'suppressed');
  assert.equal(probed, 0, '主动退出后连进程和安装包都不应探测');
  assert.equal(launched, 0, '退出应当一直有效，直到用户自己再打开 Maclawd');
}));
