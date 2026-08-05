import {
  installHooks, installPermissionHook, uninstallHooks, uninstallPermissionHook,
} from './hook-install.js';
import {
  installCodexHooks, installCodexPermissionHook,
  uninstallCodexHooks, uninstallCodexPermissionHook,
} from './codex-hook-install.js';
import {
  installWorkBuddyHooks, uninstallWorkBuddyHooks,
} from './workbuddy-hook-install.js';
import { loadSettings, saveSettings } from './settings.js';

const AGENTS = {
  'claude-code': {
    settingKey: 'hookEnhancement',
    install: ({ port, settings }) => {
      installHooks();
      if (settings.permissionBubble) installPermissionHook({ port });
    },
    uninstall: () => {
      uninstallHooks();
      uninstallPermissionHook();
    },
  },
  codex: {
    settingKey: 'codexHookEnhancement',
    install: ({ settings }) => {
      installCodexHooks();
      if (settings.permissionBubble) installCodexPermissionHook();
    },
    uninstall: () => {
      uninstallCodexHooks();
      uninstallCodexPermissionHook();
    },
  },
  workbuddy: {
    settingKey: 'workBuddyHookEnhancement',
    install: () => installWorkBuddyHooks(),
    uninstall: () => uninstallWorkBuddyHooks(),
  },
};

export function supportsAgentIntegration(agentId, agents = AGENTS) {
  return Object.hasOwn(agents, agentId);
}

/**
 * 把“外部 Hook 配置 + Maclawd 本地开关”当成一个事务。
 * 两边没有共同存储事务，只能在任一步失败时把外部配置补偿回修改前。
 */
export function changeAgentIntegration(agentId, action, {
  port = 4173,
  agents = AGENTS,
  load = loadSettings,
  save = saveSettings,
} = {}) {
  const agent = agents[agentId];
  if (!agent || !['install', 'repair', 'uninstall'].includes(action)) {
    throw new Error('未知 Agent 或操作');
  }
  const before = load();
  const enable = action !== 'uninstall';
  const context = { port, settings: before };

  try {
    if (enable) agent.install(context);
    else agent.uninstall(context);
    const settings = save({ [agent.settingKey]: enable });
    return { settings };
  } catch (error) {
    try {
      if (before[agent.settingKey]) agent.install(context);
      else agent.uninstall(context);
    } catch {
      // 原错误更能解释事务为何失败；Doctor 会暴露仍未恢复的外部配置。
    }
    throw error;
  }
}
