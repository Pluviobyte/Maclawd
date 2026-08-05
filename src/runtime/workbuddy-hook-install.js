import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  backupOnce, hookScriptPath, readSettings, writeSettings,
} from './hook-install.js';

/**
 * WorkBuddy 5.3.x 内置的是 Claude Code 兼容 Hook，但桌面端并不保证支持
 * Claude Code 的全部新事件。首版只订阅已经在 WorkBuddy 上验证过的集合。
 */
export const WORKBUDDY_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Notification',
  'PreCompact',
];

const SCRIPT_NAME = 'maclawd-hook.js';
const SOURCE_MARKER = '--maclawd-source=workbuddy';

export function workBuddySettingsPath({
  home = homedir(), env = process.env, exists = existsSync,
} = {}) {
  const override = env.MACLAWD_WORKBUDDY_SETTINGS?.trim();
  if (override) return override;

  const configured = env.WORKBUDDY_CONFIG_DIR?.trim();
  if (configured) return join(configured, 'settings.json');

  const current = join(home, '.workbuddy-ai', 'settings.json');
  const legacy = join(home, '.workbuddy', 'settings.json');
  if (exists(current)) return current;
  if (exists(legacy)) return legacy;

  // settings 还没生成时，用已有数据目录判断。裸 ~/.workbuddy 也可能属于别的
  // 工具，只有出现 WorkBuddy 自己的 projects 目录才采信它。
  if (exists(dirname(current))) return current;
  if (exists(join(dirname(legacy), 'projects'))) return legacy;
  return current;
}

function isOurs(entry) {
  return entry?.type === 'command'
    && typeof entry.command === 'string'
    && entry.command.includes(SCRIPT_NAME)
    && entry.command.trim().endsWith(SOURCE_MARKER);
}

function entry(event, nodePath) {
  return {
    type: 'command',
    command: `${JSON.stringify(nodePath)} ${JSON.stringify(hookScriptPath())} ${event} ${SOURCE_MARKER}`,
    timeout: 5,
  };
}

function groupsFor(hooks, event) {
  return Array.isArray(hooks[event]) ? hooks[event] : [];
}

export function installWorkBuddyHooks({ nodePath = process.execPath } = {}) {
  const path = workBuddySettingsPath();
  const settings = readSettings(path);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const installed = [];
  const alreadyInstalled = [];

  const backedUp = backupOnce(path);
  for (const event of WORKBUDDY_HOOK_EVENTS) {
    const groups = groupsFor(hooks, event);
    let found = false;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      if (group.hooks.some(isOurs)) found = true;
      group.hooks = group.hooks.map((hook) => (isOurs(hook) ? entry(event, nodePath) : hook));
    }
    if (found) alreadyInstalled.push(event);
    else {
      groups.push({ hooks: [entry(event, nodePath)] });
      installed.push(event);
    }
    hooks[event] = groups;
  }

  settings.hooks = hooks;
  writeSettings(path, settings);
  return { path, installed, alreadyInstalled, backedUp };
}

export function uninstallWorkBuddyHooks() {
  const path = workBuddySettingsPath();
  const settings = readSettings(path);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const removed = [];

  for (const event of Object.keys(hooks)) {
    const kept = [];
    let touched = false;
    for (const group of groupsFor(hooks, event)) {
      if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
      const remaining = group.hooks.filter((hook) => !isOurs(hook));
      if (remaining.length !== group.hooks.length) touched = true;
      if (remaining.length) kept.push({ ...group, hooks: remaining });
    }
    if (!touched) continue;
    removed.push(event);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }

  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  if (removed.length) writeSettings(path, settings);
  return { path, removed };
}

export function workBuddyHookStatus() {
  const path = workBuddySettingsPath();
  let settings;
  try {
    settings = readSettings(path);
  } catch (error) {
    return {
      path, script: hookScriptPath(), installed: [], missing: WORKBUDDY_HOOK_EVENTS,
      error: error.message,
    };
  }
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const installed = WORKBUDDY_HOOK_EVENTS.filter((event) =>
    groupsFor(hooks, event).some((group) => Array.isArray(group?.hooks) && group.hooks.some(isOurs)));
  return {
    path,
    script: hookScriptPath(),
    installed,
    missing: WORKBUDDY_HOOK_EVENTS.filter((event) => !installed.includes(event)),
  };
}
