/**
 * 管理者看护：把运行时的生命周期跟它的管理者（macOS 外壳）绑在一起。
 *
 * 外壳正常退出会给运行时 SIGTERM，用不到这里；这里兜的是**强制退出**：
 * 外壳被 SIGKILL 后 terminationHandler 不会执行，Node 子进程被过继给
 * launchd 继续跑——HTTP 服务、定时器、额度轮询都还活着，屏幕上却什么
 * 都没有。更糟的是端点文件里的 pid 是活的，hook 据此判定「Maclawd 在
 * 运行」，于是桌宠永远不会被自动拉起。运行时必须自己发现管理者没了、
 * 收摊退出；端点一清，下一个 agent 会话就能把完整的应用重新拉起来。
 *
 * 两种管理者，两种存活判据：
 *   · 出生时的父进程（MACLAWD_PARENT_PID）——我们是它的直接子进程，
 *     它一死 ppid 立即变 1，没有 pid 复用的歧义
 *   · 接管者（/api/runtime/adopt）——新外壳复用旧运行时（.reuse）时
 *     不是父子关系，只能退回 kill(pid, 0) 探测
 *
 * 发现管理者消失后**先进宽限期再退出**：外壳被强杀后用户可能立刻重新
 * 打开，新外壳的 adopt 请求要能赶在退出之前把看护重新武装起来。
 *
 * 终端里手动 `maclawd-usage serve` 时 MACLAWD_PARENT_PID 不存在，
 * 看护完全不启用，adopt 也一律拒绝——那个进程的生死属于终端里的用户，
 * 外壳无权把自己的生命周期强加给它。
 */

export const MANAGER_WATCH_INTERVAL_MS = 5_000;
export const MANAGER_GONE_GRACE_MS = 10_000;

/** 解析外壳传入的父进程 pid。没传或不合法 → null（不启用看护）。 */
export function parentPidFromEnv(env = process.env) {
  const raw = env.MACLAWD_PARENT_PID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/** kill(pid, 0) 只查存在性，不真的发信号。EPERM = 进程在，只是不属于我们。 */
function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function createManagerWatch({
  parentPid = parentPidFromEnv(),
  onManagerGone,
  intervalMs = MANAGER_WATCH_INTERVAL_MS,
  graceMs = MANAGER_GONE_GRACE_MS,
  getPpid = () => process.ppid,
  isPidAlive = defaultIsPidAlive,
  now = Date.now,
} = {}) {
  // null = 从未有管理者（CLI 直跑）。永不看护，也不可被接管。
  let manager = parentPid ? { pid: parentPid, direct: true } : null;
  let goneSince = null;
  let timer = null;
  let fired = false;

  const managerAlive = () => (
    manager.direct ? getPpid() === manager.pid : isPidAlive(manager.pid)
  );

  /** 单步检查。导出是为了测试不必等真实定时器。 */
  function check() {
    if (!manager || fired) return;
    if (managerAlive()) {
      goneSince = null;
      return;
    }
    goneSince ??= now();
    if (now() - goneSince >= graceMs) {
      fired = true;
      stop();
      onManagerGone?.();
    }
  }

  /**
   * 新外壳接管。返回是否接受——拒绝的两种情况都不是错误：
   * CLI 直跑的运行时没有管理者概念；pid 不合法则当没说。
   */
  function adopt(pid) {
    if (!manager) return false;
    if (!Number.isInteger(pid) || pid <= 1) return false;
    manager = { pid, direct: false };
    goneSince = null;
    return true;
  }

  function start() {
    if (!manager || timer) return;
    timer = setInterval(check, intervalMs);
    // 看护自己绝不能拖住进程退出
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, check, adopt };
}
