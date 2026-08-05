import { homedir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings, backupOnce, repoRoot } from './hook-install.js';

const SCRIPT_NAME = 'maclawd-codex-hook.js';
const SCRIPT = join(repoRoot(), 'hooks', SCRIPT_NAME);
const PERMISSION_EVENT = 'PermissionRequest';

// Codex currently supports synchronous command hooks only. Keep the list aligned
// with the official hooks reference; unsupported Claude-only events stay out.
export const CODEX_HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Stop', 'SessionEnd',
];

export function codexHooksPath() {
  const override = process.env.MACLAWD_CODEX_HOOKS_PATH?.trim();
  if (override) return override;
  const home = process.env.MACLAWD_CODEX_HOME?.trim()
    || process.env.CODEX_HOME?.trim()
    || join(homedir(), '.codex');
  return join(home, 'hooks.json');
}

function isOurs(entry) {
  return entry?.type === 'command'
    && typeof entry.command === 'string'
    && entry.command.includes(SCRIPT_NAME);
}

function entry(event, nodePath, timeout = 2) {
  return {
    type: 'command',
    command: `${nodePath} ${JSON.stringify(SCRIPT)} ${event}`,
    timeout,
  };
}

function mutateEvent(hooks, event, { install, nodePath, timeout }) {
  const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
  let found = false;
  const kept = [];
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
    const ours = group.hooks.some(isOurs);
    if (ours) found = true;
    const next = install
      ? group.hooks.map((hook) => (isOurs(hook) ? entry(event, nodePath, timeout) : hook))
      : group.hooks.filter((hook) => !isOurs(hook));
    if (next.length) kept.push({ ...group, hooks: next });
  }
  if (install && !found) kept.push({ hooks: [entry(event, nodePath, timeout)] });
  if (kept.length) hooks[event] = kept;
  else delete hooks[event];
  return found;
}

function change(events, install, { nodePath = process.execPath } = {}) {
  const path = codexHooksPath();
  const settings = readSettings(path);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const changed = [];
  const existing = [];
  if (install) backupOnce(path);
  for (const event of events) {
    const found = mutateEvent(hooks, event, {
      install, nodePath, timeout: event === PERMISSION_EVENT ? 30 : 2,
    });
    (found ? existing : changed).push(event);
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  if (install || existing.length) writeSettings(path, settings);
  return { path, changed, existing };
}

export function installCodexHooks(options) { return change(CODEX_HOOK_EVENTS, true, options); }
export function uninstallCodexHooks(options) { return change(CODEX_HOOK_EVENTS, false, options); }
export function installCodexPermissionHook(options) { return change([PERMISSION_EVENT], true, options); }
export function uninstallCodexPermissionHook(options) { return change([PERMISSION_EVENT], false, options); }

export function codexHookStatus() {
  const path = codexHooksPath();
  let settings;
  try { settings = readSettings(path); } catch (error) {
    return { path, installed: [], missing: CODEX_HOOK_EVENTS, permissionInstalled: false, error: error.message };
  }
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const has = (event) => (hooks[event] ?? []).some((group) =>
    Array.isArray(group?.hooks) && group.hooks.some(isOurs));
  const installed = CODEX_HOOK_EVENTS.filter(has);
  return {
    path,
    installed,
    missing: CODEX_HOOK_EVENTS.filter((event) => !installed.includes(event)),
    permissionInstalled: has(PERMISSION_EVENT),
    // Codex asks the user to trust non-managed hooks in /hooks. Config presence
    // cannot prove that one-time trust decision, so Doctor states it explicitly.
    trustReviewRequired: installed.length > 0,
  };
}
