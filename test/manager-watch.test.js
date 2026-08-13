import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManagerWatch, parentPidFromEnv } from '../src/runtime/manager-watch.js';

/**
 * 管理者看护。
 *
 * 守的是「外壳被强制退出后运行时变孤儿」：HTTP 服务和定时器让进程
 * 永远活着，端点文件里的 pid 又是活的，hook 据此判定「Maclawd 在运行」，
 * 桌宠从此再也不会被自动拉起。运行时必须自己发现管理者没了、收摊退出。
 *
 * 同时守它的边界：CLI 直跑（终端里 `maclawd-usage serve`）的进程
 * 生死属于终端里的用户，看护不启用，接管也一律拒绝。
 */

test('MACLAWD_PARENT_PID 解析：缺失、空串、非数字、launchd 都不算', () => {
  assert.equal(parentPidFromEnv({}), null);
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: '' }), null);
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: 'abc' }), null);
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: '-5' }), null);
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: '0' }), null);
  // pid 1 是 launchd：声称它是管理者等于声称没有管理者
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: '1' }), null);
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: '4242' }), 4242);
  assert.equal(parentPidFromEnv({ MACLAWD_PARENT_PID: ' 4242 ' }), 4242);
});

test('父进程活着时什么都不发生', () => {
  let gone = 0;
  const watch = createManagerWatch({
    parentPid: 500,
    getPpid: () => 500,
    now: () => 0,
    onManagerGone: () => { gone += 1; },
  });
  watch.check();
  watch.check();
  assert.equal(gone, 0);
});

test('父进程死了 → 宽限期内不动手，超过宽限期才收摊', () => {
  let clock = 0;
  let gone = 0;
  const watch = createManagerWatch({
    parentPid: 500,
    graceMs: 10_000,
    // 成为孤儿后 ppid 是 launchd 的 1
    getPpid: () => 1,
    now: () => clock,
    onManagerGone: () => { gone += 1; },
  });
  watch.check(); // 首次发现：进入宽限期
  assert.equal(gone, 0, '发现瞬间不该立刻退出——要给重开的外壳留出接管窗口');
  clock = 5_000;
  watch.check();
  assert.equal(gone, 0);
  clock = 10_000;
  watch.check();
  assert.equal(gone, 1, '宽限期结束必须收摊');
  clock = 20_000;
  watch.check();
  assert.equal(gone, 1, '只收摊一次');
});

test('宽限期内父进程「回来了」会撤销倒计时', () => {
  // ppid 不会真的回来，但 adopt 后换用 pid 探测时，探测抖动（EPERM 边界）
  // 不该积累成误杀。goneSince 必须在每次看到活着时清零。
  let clock = 0;
  let alivePid = false;
  let gone = 0;
  const watch = createManagerWatch({
    parentPid: 500,
    graceMs: 10_000,
    getPpid: () => 500,
    isPidAlive: () => alivePid,
    now: () => clock,
    onManagerGone: () => { gone += 1; },
  });
  assert.equal(watch.adopt(700), true);
  watch.check(); // 700 探测为死：进入宽限期
  clock = 6_000;
  alivePid = true;
  watch.check(); // 又活了：撤销
  clock = 12_000;
  alivePid = false;
  watch.check(); // 重新进入宽限期，从 12s 起算
  assert.equal(gone, 0, '上一轮的倒计时必须已被清零');
  clock = 22_000;
  watch.check();
  assert.equal(gone, 1);
});

test('宽限期内被新外壳接管 → 不退出，改盯新管理者', () => {
  let clock = 0;
  let newShellAlive = true;
  let gone = 0;
  const watch = createManagerWatch({
    parentPid: 500,
    graceMs: 10_000,
    getPpid: () => 1, // 旧父进程已死
    isPidAlive: () => newShellAlive,
    now: () => clock,
    onManagerGone: () => { gone += 1; },
  });
  watch.check(); // 进入宽限期
  clock = 8_000;
  assert.equal(watch.adopt(900), true, '外壳传来的接管必须被接受');
  clock = 30_000;
  watch.check();
  assert.equal(gone, 0, '接管之后旧的倒计时不该继续走');

  // 新管理者死了 → 从头走一遍宽限期
  newShellAlive = false;
  watch.check();
  clock = 40_000;
  watch.check();
  assert.equal(gone, 1);
});

test('CLI 直跑（没有父进程标记）：不看护，也不可被接管', () => {
  let gone = 0;
  const watch = createManagerWatch({
    parentPid: null,
    getPpid: () => 1,
    now: () => 0,
    onManagerGone: () => { gone += 1; },
  });
  watch.check();
  assert.equal(gone, 0, '终端里的进程生死属于终端的用户');
  assert.equal(watch.adopt(900), false, '外壳无权把生命周期强加给 CLI 进程');
});

test('接管的 pid 必须合法', () => {
  const watch = createManagerWatch({
    parentPid: 500, getPpid: () => 500, now: () => 0, onManagerGone: () => {},
  });
  assert.equal(watch.adopt(0), false);
  assert.equal(watch.adopt(1), false);
  assert.equal(watch.adopt(1.5), false);
  assert.equal(watch.adopt('900'), false);
});
