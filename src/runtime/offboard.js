import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  settingsPath as claudeSettingsPath, uninstallHooks, uninstallPermissionHook,
} from './hook-install.js';
import {
  codexHome, codexHooksPath, uninstallCodexHooks, uninstallCodexPermissionHook,
} from './codex-hook-install.js';
import {
  uninstallWorkBuddyHooks, workBuddySettingsPath,
} from './workbuddy-hook-install.js';
import { cursorHooksPath, uninstallCursorHook } from './cursor-hook-install.js';
import { uninstallStatusline } from './statusline-install.js';
import { saveSettings } from './settings.js';
import { dataDir, pricingCacheDir } from './paths.js';

/**
 * Offboarding：一键移除 Maclawd 写进**别的工具**的全部配置。
 *
 * 存在的理由：分发形态是 DMG 拖装，没有卸载器。用户的卸载动作就是把
 * .app 拖进废纸篓——那一刻起，settings.json 里的 hook 条目全部指向一个
 * 不存在的包：每个 agent 事件 spawn 一次失败命令，状态行直接消失，
 * 而用户没有任何入口能收拾这些。所以收拾残局必须是删除 .app **之前**
 * 就能一键完成的事。
 *
 * 三条规则：
 *
 * 1. **只移除自己的，规则与安装器完全对称。** 每一项都调用对应
 *    install 模块的 uninstall——身份判据（脚本文件名 / 权限 URL /
 *    宠物 id）只有一份实现，不在这里另写一套。
 * 2. **先关开关，再动文件。** hook 自愈看门狗以开关为唯一授权来源；
 *    反过来的顺序会留出一个「条目刚移除、开关还开着」的窗口，
 *    看门狗可能把刚移除的 hook 补回去。
 * 3. **一个文件坏了不挡住其余的。** 每项独立 try/catch，错误收集上报；
 *    「Claude 的 settings.json 解析失败」不该让 Codex 的清理也做不成。
 *
 * 刻意**不删**的东西（在 leftovers 里如实上报，让 UI / 文档指给用户）：
 *   · *.maclawd-backup —— 首次修改前的备份是最后的安全网，自动删它
 *     违背它存在的目的
 *   · 自己的数据目录与缓存目录 —— 里面是用户的用量数据，删数据是
 *     另一个按钮（/api/reset）的事，两种授权不能合并
 */

export const CODEX_PET_ID = 'maclawd';

export function codexPetDir() {
  return join(codexHome(), 'pets', CODEX_PET_ID);
}

/**
 * 移除 Codex 宠物包。与 CodexPetInstaller 的覆盖保护同一条规则：
 * 目录存在但 pet.json 的 id 不是 maclawd，就一根手指都不碰。
 */
export function removeCodexPet({ dir = codexPetDir() } = {}) {
  if (!existsSync(dir)) return { removed: false, existed: false, path: dir };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'pet.json'), 'utf-8'));
  } catch {
    manifest = null;
  }
  if (manifest?.id !== CODEX_PET_ID) {
    return {
      removed: false, existed: true, path: dir,
      blocked: '目录存在但不是可识别的 Maclawd 宠物包，未触碰。',
    };
  }
  rmSync(dir, { recursive: true, force: true });
  return { removed: true, existed: true, path: dir };
}

/**
 * @returns {{ok: boolean, actions: object, errors: Array<{target: string, message: string}>,
 *            settings: object, leftovers: object}}
 */
export function offboard() {
  const errors = [];
  const actions = {};

  // 规则 2：开关先关。这样即使某一步失败、hook 条目残留，
  // 看门狗也不会再把缺失当故障修回去，重试 offboard 总是安全的。
  const settings = saveSettings({
    hookEnhancement: false,
    codexHookEnhancement: false,
    workBuddyHookEnhancement: false,
    cursorHookEnhancement: false,
    permissionBubble: false,
    quotaStatusline: false,
    quotaTracking: false,
  });

  const attempt = (target, run) => {
    try {
      actions[target] = run();
    } catch (err) {
      errors.push({ target, message: err?.message ?? String(err) });
    }
  };

  attempt('claudeHooks', () => uninstallHooks());
  attempt('claudePermission', () => uninstallPermissionHook());
  // chain 模式下这一步会把用户原来的状态行从 sidecar 原样还原回去——
  // 所以 offboard 必须发生在数据目录还在的时候（sidecar 存在那里）。
  attempt('statusline', () => uninstallStatusline());
  attempt('codexHooks', () => uninstallCodexHooks());
  attempt('codexPermission', () => uninstallCodexPermissionHook());
  attempt('workBuddyHooks', () => uninstallWorkBuddyHooks());
  attempt('cursorHook', () => uninstallCursorHook());
  attempt('codexPet', () => removeCodexPet());

  // 备份文件只报告存在的：让 UI 有的放矢，而不是甩一串可能不存在的路径。
  const backups = [
    `${claudeSettingsPath()}.maclawd-backup`,
    `${codexHooksPath()}.maclawd-backup`,
    `${workBuddySettingsPath()}.maclawd-backup`,
    `${cursorHooksPath()}.maclawd-backup`,
  ].filter((path) => existsSync(path));

  return {
    ok: errors.length === 0,
    actions,
    errors,
    settings,
    leftovers: {
      backups,
      dataDir: dataDir(),
      cacheDir: pricingCacheDir(),
      // 登录项与偏好设置（UserDefaults）在系统侧，由外壳负责注销 / 文档指引。
      codexPetBlocked: actions.codexPet?.blocked ?? null,
    },
  };
}
