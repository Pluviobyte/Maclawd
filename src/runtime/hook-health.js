import { statSync, watch } from 'node:fs';
import { hookStatus, installHooks, settingsPath } from './hook-install.js';
import { loadSettings } from './settings.js';

/**
 * hook 装完就不管了 —— 这是个静默失效点。
 *
 * `~/.claude/settings.json` 不只有我们在写：用户会手改，别的工具会覆盖，
 * 恢复备份会整段回退。任何一种发生之后，我们的 hook 条目就没了，
 * 桌宠从此永远停在 idle——**而且不会报错**，因为「没有事件」和
 * 「一切正常但很闲」在我们这边长得一模一样。用户唯一能观察到的现象是
 * 「它坏了」，而没有任何线索指向原因。
 *
 * 所以盯着这个文件，掉了就补回去。**前提是 hookEnhancement 开关开着**——
 * 开关是唯一的授权来源：用户关闭开关后条目消失是「撤回授权」，不是故障，
 * 而这两种情况在文件层面长得一模一样，必须回头问设置才分得开。
 * 修复行为另有两条护栏，来自 clawd-on-desk 踩过的坑：
 *
 * 1. **文件突然变小就不修。** 别的工具可能正写到一半，或者用户正在重构
 *    自己的配置。这时候按我们的记忆去补，很容易把别人的 hook 覆盖掉。
 *    宁可这一轮不修——下一轮文件稳定了自然会修。
 *
 * 2. **同一类失败重复出现就停手。** 修不好的东西重试一百次也修不好，
 *    只会一直写文件。连续失败到上限就标记「需要人工处理」，
 *    等签名变了（也就是问题性质变了）再重新开始。
 */

/** 文件比上次观察到的小这么多比例，就认为「有人正在大改」，本轮不修。 */
export const SHRINK_GUARD_RATIO = 0.5;

/** 同一类失败连续修几次之后放弃。 */
export const MAX_REPAIR_ATTEMPTS = 3;

/** 文件事件很吵（一次保存能触发好几下），先攒一攒再看。 */
export const SETTLE_MS = 1200;

/** 缺了哪几个事件——用它当「问题的签名」，签名变了就重新开始计数。 */
function signatureOf(status) {
  return status.missing.slice().sort().join(',') || (status.error ? `error:${status.error}` : '');
}

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * 检查一次，需要就修。
 *
 * @returns {{action:'healthy'|'repaired'|'failed'|'skipped-shrink'|'manual', detail?:string}}
 */
export function checkAndRepair(state, {
  status = hookStatus,
  repair = installHooks,
  size = sizeOf,
  path = settingsPath(),
  enabled = () => loadSettings().hookEnhancement === true,
} = {}) {
  // 开关是唯一的授权来源，必须最先问。用户关闭开关时 uninstallHooks 会把
  // 条目移掉，而只看文件的话，「用户撤回了授权」和「被第三方覆盖」
  // 长得一模一样——看门狗曾经因此把刚卸载的 hook 原样装回去。
  // 关闭时同时清掉记忆：everHealthy / lastSize 都是开启期间的基线，
  // 带着它们进入下一次开启会误判。
  if (!enabled()) {
    state.everHealthy = false;
    state.signature = null;
    state.attempts = 0;
    state.lastSize = 0;
    return { action: 'healthy', detail: '开关关闭' };
  }
  const report = status();
  // 一个都没装 = 用户没开启这个功能，不是「坏了」。自愈只负责
  // 「本来装着、后来掉了」，不负责替用户做开启的决定。
  if (report.installed.length === 0 && !state.everHealthy) {
    return { action: 'healthy', detail: '未启用' };
  }
  if (report.missing.length === 0 && !report.error) {
    state.everHealthy = true;
    state.signature = null;
    state.attempts = 0;
    state.lastSize = size(path);
    return { action: 'healthy' };
  }

  // 护栏 1：文件突然变小，多半是别人正在写。这轮不动。
  const current = size(path);
  if (state.lastSize > 0 && current < state.lastSize * SHRINK_GUARD_RATIO) {
    return { action: 'skipped-shrink', detail: `${state.lastSize} → ${current}` };
  }

  // 护栏 2：同一类失败修不好就别一直修
  const signature = signatureOf(report);
  if (signature !== state.signature) {
    state.signature = signature;
    state.attempts = 0;
  }
  if (state.attempts >= MAX_REPAIR_ATTEMPTS) {
    return { action: 'manual', detail: signature };
  }

  state.attempts += 1;
  try {
    repair();
  } catch (err) {
    return { action: 'failed', detail: err?.message ?? String(err) };
  }
  const after = status();
  if (after.missing.length > 0) {
    return { action: 'failed', detail: `仍然缺 ${after.missing.join(', ')}` };
  }
  state.lastSize = size(path);
  state.attempts = 0;
  state.signature = null;
  return { action: 'repaired', detail: report.missing.join(', ') };
}

export function createHealthState() {
  return { signature: null, attempts: 0, lastSize: 0, everHealthy: false };
}

/**
 * 起一个看门狗：盯着 settings.json，掉了就补。
 *
 * 返回 stop()。watch 本身可能因为文件被原子替换（rename）而失效，
 * 所以每次事件后重新挂——这是 fs.watch 在 macOS 上的老问题，
 * 不重挂的话「用编辑器保存一次」之后就再也收不到通知了。
 */
export function watchHooks({
  onResult = () => {},
  settleMs = SETTLE_MS,
  path = settingsPath(),
  check = checkAndRepair,
} = {}) {
  const state = createHealthState();
  let watcher = null;
  let timer = null;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    try {
      onResult(check(state));
    } catch {
      // 看门狗自己绝不能把服务弄挂
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { run(); attach(); }, settleMs);
    timer.unref?.();
  };

  function attach() {
    if (stopped) return;
    try { watcher?.close(); } catch { /* 已经关了 */ }
    watcher = null;
    try {
      watcher = watch(path, { persistent: false }, schedule);
      watcher.on('error', schedule);
    } catch {
      // 文件还不存在：等下一轮定时检查。不存在本身也是一种「缺」，
      // 但那时候用户根本没装过 hook，run() 会判成「未启用」。
    }
  }

  run();
  attach();
  return () => {
    stopped = true;
    clearTimeout(timer);
    try { watcher?.close(); } catch { /* 已经关了 */ }
  };
}
