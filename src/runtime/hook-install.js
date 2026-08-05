import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Claude Code hook 安装 / 卸载。
 *
 * 这是本项目唯一会写「不属于自己」的文件的地方（`~/.claude/settings.json`），
 * 所以约束比别处都严：
 *
 * 1. **严格对称。** 卸载只移除命令里带本仓库 hook 脚本路径的条目，
 *    用户自己的 hook、别的工具装的 hook 一个都不碰。
 * 2. **写前备份。** 第一次修改会留一份 `.maclawd-backup`。
 * 3. **原子写。** 临时文件 + rename，避免写一半被杀留下坏 JSON——
 *    那会让用户的 Claude Code 直接起不来。
 * 4. **只订阅状态事件。** 不注册 PreToolUse 的阻塞返回值，
 *    权限决策完全留在 Claude Code 自己的流程里（见 design/token-tracking.md）。
 */

const HOOK_SCRIPT = 'hooks/maclawd-hook.js';
const BACKUP_SUFFIX = '.maclawd-backup';

/**
 * 权限决策通道用的是 `type: "http"` hook——它与状态 hook 的本质区别是
 * **Claude Code 会等待返回**。所以它必须是独立的一步：
 * 状态订阅是无害的旁观，拦截权限是介入别人的决策流程。
 */
const PERMISSION_EVENT = 'PermissionRequest';
const PERMISSION_PATH = '/api/permission';
/** 略小于代理端的 25s 超时，让我们先超时并交回，而不是让 Claude Code 先放弃。 */
const PERMISSION_TIMEOUT_S = 30;

/**
 * 订阅的事件。全部是**状态通知**，没有一个会改变 Claude Code 的行为。
 *
 * 每项的 matcher 留空表示匹配全部；PreToolUse 需要拿到 tool_name，
 * 所以也不设 matcher，由写入器自己分辨。
 */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'CwdChanged',
];

export function repoRoot() {
  return resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

export function hookScriptPath() {
  return join(repoRoot(), HOOK_SCRIPT);
}

export function settingsPath() {
  const override = process.env.MACLAWD_CLAUDE_SETTINGS?.trim();
  if (override) return override;
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  return join(configured || join(homedir(), '.claude'), 'settings.json');
}

/**
 * 读用户的 settings.json。**导出**是刻意的：状态行注册器
 * （statusline-install.js）必须和这里用同一份实现。两份「安全读写别人的
 * 配置文件」的代码必然漂移，而漂移的表现是把用户的 Claude Code 弄坏。
 */
export function readSettings(path = settingsPath()) {
  try {
    const text = readFileSync(path, 'utf-8');
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    if (err?.code === 'ENOENT') return {};
    // 解析失败绝不能覆盖——那会把用户的配置弄丢。
    throw new Error(`无法解析 ${path}，请先修好它再安装：${err.message}`);
  }
}

export function writeSettings(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.maclawd.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(temp, path);
}

/** 首次修改前留一份备份。已存在就不覆盖——第一份才是「动手之前」的样子。 */
export function backupOnce(path = settingsPath()) {
  try {
    copyFileSync(path, `${path}${BACKUP_SUFFIX}`, 0);
    return true;
  } catch {
    // 原文件不存在、或备份已存在（copyFileSync 的 mode 0 表示不覆盖）
    return false;
  }
}

/**
 * 判断一个 hook 条目是不是我们写的。
 *
 * **按脚本文件名认，不按完整路径认。** 原来比的是完整路径，实测撞车：
 * hook 从源码目录装上（`~/Desktop/Maclawd/hooks/maclawd-hook.js`），
 * 而打包后的 app 把 `hookScriptPath()` 解析到自己包里的那份副本，
 * 两条路径对不上，于是**装好的 14 个 hook 被报成「一个都没装」**。
 * 移动过 .app、或者装完之后升级过版本，都会撞上同一件事。
 *
 * 后果不只是显示不准：自愈看到「没装」，一旦判定该修，就会再装一套
 * 指向新路径的——用户拿到的是每个事件触发两次。
 *
 * 文件名是够用的身份：`maclawd-hook.js` 不会是别人的东西。
 * 认出来之后 installHooks 会把命令刷新成当前路径，路径漂移自动收敛。
 */
function isOurs(entry, scriptPath) {
  const command = entry?.command;
  if (typeof command !== 'string') return false;
  return command.includes(scriptPath) || command.includes(HOOK_SCRIPT_NAME);
}

/** 只取文件名部分，用作身份判据。 */
const HOOK_SCRIPT_NAME = HOOK_SCRIPT.split('/').pop();

/** 权限 hook 认 URL 而不是命令路径。 */
function isOurPermission(entry) {
  return entry?.type === 'http'
    && typeof entry.url === 'string'
    && entry.url.includes(PERMISSION_PATH);
}

function ourEntry(scriptPath, event, nodePath) {
  return {
    type: 'command',
    command: `${nodePath} ${JSON.stringify(scriptPath)} ${event}`,
    // 这一条是关键：async 让 Claude Code 完全不等 hook 返回。
    // 没有它就只能靠写入器自律「跑得快」，那是承诺不是保证。
    async: true,
    timeout: 5,
  };
}

/**
 * @returns {{installed: string[], alreadyInstalled: string[], path: string, backedUp: boolean}}
 */
export function installHooks({ nodePath = process.execPath } = {}) {
  const path = settingsPath();
  const script = hookScriptPath();
  const settings = readSettings(path);

  const backedUp = backupOnce(path);

  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const installed = [];
  const alreadyInstalled = [];

  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const existing = groups.find((group) => Array.isArray(group?.hooks)
      && group.hooks.some((entry) => isOurs(entry, script)));
    if (existing) {
      alreadyInstalled.push(event);
      // 重新安装时刷新命令（可能换了 node 路径或仓库位置）
      existing.hooks = existing.hooks.map((entry) => (
        isOurs(entry, script) ? ourEntry(script, event, nodePath) : entry
      ));
      continue;
    }
    groups.push({ hooks: [ourEntry(script, event, nodePath)] });
    hooks[event] = groups;
    installed.push(event);
  }

  settings.hooks = hooks;
  writeSettings(path, settings);
  return { installed, alreadyInstalled, path, backedUp };
}

/**
 * 卸载。**只移除自己的条目**，并且在移除后如果某个分组空了才删分组，
 * 分组里还有别人的 hook 就原样保留。
 */
export function uninstallHooks() {
  const path = settingsPath();
  const script = hookScriptPath();
  const settings = readSettings(path);
  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const removed = [];

  for (const event of Object.keys(hooks)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    let touched = false;
    const kept = [];
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
      const remaining = group.hooks.filter((entry) => !isOurs(entry, script));
      if (remaining.length !== group.hooks.length) touched = true;
      // 分组里还有别人的 hook 就保留分组
      if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
    }
    if (touched) {
      removed.push(event);
      if (kept.length > 0) hooks[event] = kept;
      else delete hooks[event];
    }
  }

  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;

  if (removed.length > 0) writeSettings(path, settings);
  return { removed, path };
}

/** 当前安装状态，供面板与 CLI 显示。 */
export function hookStatus() {
  const path = settingsPath();
  const script = hookScriptPath();
  let settings;
  try {
    settings = readSettings(path);
  } catch (err) {
    return { path, script, installed: [], missing: HOOK_EVENTS, error: err.message };
  }
  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const installed = [];
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((e) => isOurs(e, script)))) {
      installed.push(event);
    }
  }
  return {
    path,
    script,
    installed,
    missing: HOOK_EVENTS.filter((e) => !installed.includes(e)),
  };
}


// ---------- 权限决策通道（独立安装） ----------

function permissionEntry(port) {
  return {
    type: 'http',
    url: `http://127.0.0.1:${port}${PERMISSION_PATH}?agent=claude-code`,
    timeout: PERMISSION_TIMEOUT_S,
  };
}

/**
 * 安装权限 hook。**与状态 hook 完全分开**——用户可以只要状态动画而不要
 * Maclawd 插手权限决策，那是两个性质不同的授权。
 *
 * 服务端在通道关闭、超时、或 Maclawd 重启时一律返回空对象（不表态），
 * 所以即便这个 hook 装着而 Maclawd 没开，Claude Code 也只是拿到一个失败的
 * HTTP 请求然后继续走自己的流程——不会卡住。
 */
export function installPermissionHook({ port = 4173 } = {}) {
  const path = settingsPath();
  const settings = readSettings(path);
  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const groups = Array.isArray(hooks[PERMISSION_EVENT]) ? hooks[PERMISSION_EVENT] : [];

  const existing = groups.find((group) => Array.isArray(group?.hooks)
    && group.hooks.some(isOurPermission));
  if (existing) {
    existing.hooks = existing.hooks.map((entry) => (
      isOurPermission(entry) ? permissionEntry(port) : entry
    ));
  } else {
    groups.push({ hooks: [permissionEntry(port)] });
  }

  hooks[PERMISSION_EVENT] = groups;
  settings.hooks = hooks;
  writeSettings(path, settings);
  return { installed: !existing, refreshed: Boolean(existing), path, port };
}

export function uninstallPermissionHook() {
  const path = settingsPath();
  const settings = readSettings(path);
  const hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const groups = Array.isArray(hooks[PERMISSION_EVENT]) ? hooks[PERMISSION_EVENT] : [];

  let removed = false;
  const kept = [];
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
    const remaining = group.hooks.filter((entry) => !isOurPermission(entry));
    if (remaining.length !== group.hooks.length) removed = true;
    if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
  }

  if (!removed) return { removed: false, path };
  if (kept.length > 0) hooks[PERMISSION_EVENT] = kept;
  else delete hooks[PERMISSION_EVENT];
  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;
  writeSettings(path, settings);
  return { removed: true, path };
}

export function permissionHookStatus() {
  const path = settingsPath();
  let settings;
  try {
    settings = readSettings(path);
  } catch {
    return { installed: false, path, url: null };
  }
  const groups = settings.hooks?.[PERMISSION_EVENT];
  const entry = Array.isArray(groups)
    ? groups.flatMap((g) => g?.hooks ?? []).find(isOurPermission)
    : null;
  return { installed: Boolean(entry), path, url: entry?.url ?? null };
}
