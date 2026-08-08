import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEndpoint } from './endpoint.js';
import { dataDir } from './paths.js';

export const AUTO_START_SUPPRESSION_FILE = 'auto-start-suppressed';

/**
 * 开 Claude Code 时把 Maclawd 拉起来。
 *
 * **为什么需要。** 用户开了 agent 却没开桌宠是常态，不是异常：
 * 重启电脑之后、退出过一次之后、或者干脆就没设开机启动。
 * 那段时间 hook 的 POST 全部连不上被静默丢弃——而那恰恰是桌宠
 * 最该出场的时候。租约能补回状态，但补不回「它根本没在屏幕上」。
 *
 * **约束。**
 *   · 只在 SessionStart 上做一次，不在每个事件上探测
 *   · 后台启动（`open -g`），绝不抢焦点——你正在打字，窗口不该跳出来
 *   · 只认**打包过的 .app**。从源码目录跑的时候没有可拉起的东西，
 *     这时静默跳过，而不是去猜一个路径
 *   · 任何失败都静默：这跑在 hook 里
 */

/**
 * hook 脚本所在的 .app 包。
 *
 * 打包后的布局是 `Maclawd.app/Contents/Resources/runtime/hooks/maclawd-hook.js`，
 * 所以从本文件往上找第一个 `.app` 目录即可。源码目录里找不到 → 返回 null。
 */
export function bundlePath(from = fileURLToPath(import.meta.url)) {
  let dir = resolve(dirname(from));
  for (let i = 0; i < 8; i += 1) {
    if (dir.endsWith('.app')) return existsSync(dir) ? dir : null;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Maclawd 现在在跑吗。端点文件带存活检查，比探测端口便宜也更准。 */
export function isRunning() {
  return readEndpoint() !== null;
}

/** 用户主动退出后，新 agent 会话不应擅自把应用复活。 */
export function isAutoStartSuppressed() {
  return existsSync(join(dataDir(), AUTO_START_SUPPRESSION_FILE));
}

/**
 * 需要的话把 app 拉起来。
 *
 * @returns {'running'|'launched'|'no-bundle'|'disabled'|'suppressed'|'failed'}
 */
export function autoStart({
  enabled = true,
  suppressed = isAutoStartSuppressed,
  running = isRunning,
  bundle = bundlePath,
  launch = defaultLaunch,
} = {}) {
  if (!enabled) return 'disabled';
  if (suppressed()) return 'suppressed';
  if (running()) return 'running';
  const app = bundle();
  if (!app) return 'no-bundle';
  try {
    launch(app);
    return 'launched';
  } catch {
    return 'failed';
  }
}

function defaultLaunch(app) {
  // -g 后台打开，不激活；-j 连 Dock 弹跳都不要。
  // detached + unref：hook 马上就要退出，绝不能等这个子进程。
  const child = spawn('/usr/bin/open', ['-g', '-j', app], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
