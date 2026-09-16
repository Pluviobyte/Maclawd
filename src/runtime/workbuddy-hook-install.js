import { homedir } from 'node:os';
import { join } from 'node:path';
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
const sourceMarker = (source) => `--maclawd-source=${source}`;

export function workBuddySettingsPath({
  home = homedir(), env = process.env, source = 'workbuddy',
} = {}) {
  if (!['workbuddy', 'workbuddy-ai'].includes(source)) throw new Error('未知 WorkBuddy 版本');
  const overseas = source === 'workbuddy-ai';
  const override = env[overseas ? 'MACLAWD_WORKBUDDY_AI_SETTINGS' : 'MACLAWD_WORKBUDDY_SETTINGS']?.trim();
  if (override) return override;
  return join(home, overseas ? '.workbuddy-ai' : '.workbuddy', 'settings.json');
}

function isOurs(entry, source = 'workbuddy') {
  return entry?.type === 'command'
    && typeof entry.command === 'string'
    && entry.command.includes(SCRIPT_NAME)
    && entry.command.trim().endsWith(sourceMarker(source));
}

function entry(event, nodePath, source) {
  return {
    type: 'command',
    command: `${JSON.stringify(nodePath)} ${JSON.stringify(hookScriptPath())} ${event} ${sourceMarker(source)}`,
    timeout: 5,
  };
}

function groupsFor(hooks, event) {
  return Array.isArray(hooks[event]) ? hooks[event] : [];
}

export function installWorkBuddyHooks({ nodePath = process.execPath, source = 'workbuddy' } = {}) {
  const path = workBuddySettingsPath({ source });
  const owns = (hook) => isOurs(hook, source) || (source === 'workbuddy-ai' && isOurs(hook, 'workbuddy'));
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
      if (group.hooks.some(owns)) found = true;
      group.hooks = group.hooks.map((hook) => (owns(hook) ? entry(event, nodePath, source) : hook));
    }
    if (found) alreadyInstalled.push(event);
    else {
      groups.push({ hooks: [entry(event, nodePath, source)] });
      installed.push(event);
    }
    hooks[event] = groups;
  }

  settings.hooks = hooks;
  writeSettings(path, settings);
  return { path, installed, alreadyInstalled, backedUp };
}

export function uninstallWorkBuddyHooks({ source = 'workbuddy' } = {}) {
  const path = workBuddySettingsPath({ source });
  const owns = (hook) => isOurs(hook, source) || (source === 'workbuddy-ai' && isOurs(hook, 'workbuddy'));
  const settings = readSettings(path);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const removed = [];

  for (const event of Object.keys(hooks)) {
    const kept = [];
    let touched = false;
    for (const group of groupsFor(hooks, event)) {
      if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
      const remaining = group.hooks.filter((hook) => !owns(hook));
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

export function workBuddyHookStatus({ source = 'workbuddy' } = {}) {
  const path = workBuddySettingsPath({ source });
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
    groupsFor(hooks, event).some((group) => Array.isArray(group?.hooks) && group.hooks.some((hook) => isOurs(hook, source))));
  return {
    path,
    script: hookScriptPath(),
    installed,
    missing: WORKBUDDY_HOOK_EVENTS.filter((event) => !installed.includes(event)),
  };
}
