import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  backupOnce, readSettings, repoRoot, writeSettings,
} from './hook-install.js';

const EVENT = 'stop';
const SCRIPT_NAME = 'maclawd-cursor-hook.js';

export function cursorHooksPath() {
  return process.env.MACLAWD_CURSOR_HOOKS_PATH?.trim()
    || join(homedir(), '.cursor', 'hooks.json');
}

export function cursorHookScriptPath() {
  return join(repoRoot(), 'hooks', SCRIPT_NAME);
}

function isOurs(entry) {
  return typeof entry?.command === 'string' && entry.command.includes(SCRIPT_NAME);
}

function hookEntry(nodePath) {
  return {
    command: `${JSON.stringify(nodePath)} ${JSON.stringify(cursorHookScriptPath())}`,
  };
}

export function installCursorHook({ nodePath = process.execPath } = {}) {
  const path = cursorHooksPath();
  const settings = readSettings(path);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const entries = Array.isArray(hooks[EVENT]) ? hooks[EVENT] : [];
  const alreadyInstalled = entries.some(isOurs);
  hooks[EVENT] = alreadyInstalled
    ? entries.map((entry) => (isOurs(entry) ? hookEntry(nodePath) : entry))
    : entries.concat(hookEntry(nodePath));

  backupOnce(path);
  settings.version ??= 1;
  settings.hooks = hooks;
  writeSettings(path, settings);
  return { path, installed: !alreadyInstalled, alreadyInstalled };
}

export function uninstallCursorHook() {
  const path = cursorHooksPath();
  const settings = readSettings(path);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const entries = Array.isArray(hooks[EVENT]) ? hooks[EVENT] : [];
  const kept = entries.filter((entry) => !isOurs(entry));
  const removed = kept.length !== entries.length;
  if (!removed) return { path, removed: false };

  if (kept.length) hooks[EVENT] = kept;
  else delete hooks[EVENT];
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  writeSettings(path, settings);
  return { path, removed: true };
}

export function cursorHookStatus() {
  const path = cursorHooksPath();
  let settings;
  try {
    settings = readSettings(path);
  } catch (error) {
    return { path, installed: [], missing: [EVENT], error: error.message };
  }
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const installed = (hooks[EVENT] ?? []).some(isOurs) ? [EVENT] : [];
  return { path, installed, missing: installed.length ? [] : [EVENT] };
}
