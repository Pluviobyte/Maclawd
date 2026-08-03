import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Maclawd 的全部本地数据都在一个目录下，卸载即净（token-tracking.md 原则 6）。
 *
 * MACLAWD_DATA_DIR 是测试与诊断用的覆盖入口。
 */
export function dataDir() {
  const override = process.env.MACLAWD_DATA_DIR?.trim();
  if (override) return override;
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Maclawd');
  }
  // 非 macOS 只用于开发与测试，桌宠本身是 Mac 产品。
  return join(homedir(), '.maclawd');
}

export function usageDir() {
  return join(dataDir(), 'usage');
}

export const ROLLUP_FILE = 'rollup.json';
export const SCAN_CACHE_FILE = 'scan-cache.json';
export const TAIL_STATE_FILE = 'tail-state.json';
export const SETTINGS_FILE = 'settings.json';
/** 动作覆盖记录：哪些动作在**真实使用**中被看见过。见 coverage.js。 */
export const COVERAGE_FILE = 'action-coverage.json';

export function usagePath(name) {
  return join(usageDir(), name);
}

export function settingsPath() {
  return join(dataDir(), SETTINGS_FILE);
}

/**
 * 价格表缓存目录。**刻意与 dataDir 分开。**
 *
 * pricing.json 是从 OpenRouter 拉来的、随时可以重取的缓存；
 * rollup.json / settings.json 是不可替代的用户数据。把可重取的缓存放进
 * 用户数据目录，会让「换个数据目录」或「清理用户数据」这类操作
 * 顺手把价表也弄丢——实测就撞到过，表现是覆盖率从 97.8% 掉回 10%。
 *
 * 注意 pricing.overrides.json **不在这里**——那是用户手写的修正，属于用户数据。
 */
export function pricingCacheDir() {
  const override = process.env.MACLAWD_PRICING_DIR?.trim();
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Caches', 'Maclawd');
  return join(homedir(), '.cache', 'maclawd');
}
