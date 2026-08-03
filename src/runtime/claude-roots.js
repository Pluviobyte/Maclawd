import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

function expandHome(value) {
  const trimmed = value.trim().replace(/[/\\]+$/, '');
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function hasClaudeData(root) {
  return existsSync(join(root, 'projects')) || existsSync(join(root, 'transcripts'));
}

const MAX_DESKTOP_DISCOVERY_DEPTH = 8;
const DESKTOP_NON_SESSION_DIRS = new Set(['rpm', 'skills']);

function defaultClaudeDesktopDataDir() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    return appData ? expandHome(appData) : join(homedir(), 'AppData', 'Roaming', 'Claude');
  }
  const configHome = process.env.XDG_CONFIG_HOME?.trim();
  return join(configHome ? expandHome(configHome) : join(homedir(), '.config'), 'Claude');
}

function discoverDesktopRoots(dir, depth, roots, onWarning) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code !== 'ENOENT') onWarning(`Claude Desktop: 无法读取 ${dir}: ${err.message}`);
    return;
  }
  const stateRoot = entries.find((entry) => entry.name === '.claude' && entry.isDirectory());
  if (stateRoot) {
    roots.push(join(dir, stateRoot.name));
    return;
  }
  if (depth >= MAX_DESKTOP_DISCOVERY_DEPTH) return;
  for (const entry of entries) {
    if (!entry.isDirectory() || DESKTOP_NON_SESSION_DIRS.has(entry.name)) continue;
    discoverDesktopRoots(join(dir, entry.name), depth + 1, roots, onWarning);
  }
}

/** Claude Desktop Cowork 为每个 local-agent session 建一份私有 .claude。 */
export function findClaudeDesktopRoots(
  desktopDataDirs = [defaultClaudeDesktopDataDir()],
  onWarning = () => {},
) {
  const roots = [];
  for (const dataDir of desktopDataDirs) {
    discoverDesktopRoots(join(dataDir, 'local-agent-mode-sessions'), 0, roots, onWarning);
  }
  return roots;
}

/**
 * 返回本进程可见的全部 Claude Code 状态根目录。
 *
 * Maclawd 是登录项/Finder 启动的 GUI 进程，拿不到用户 shell 的环境变量，所以
 * 除了默认位置和 CLAUDE_CONFIG_DIR，还要发现 ~/.claude-<profile> 这个多 profile
 * 约定。只扫 ~/.claude/projects 会让多 profile 用户的数据静默消失。
 *
 * MACLAWD_CLAUDE_DIRS 是测试与诊断用的覆盖入口，用 path.delimiter 分隔。
 */
export function getClaudeRoots({ onWarning = () => {} } = {}) {
  const override = process.env.MACLAWD_CLAUDE_DIRS?.trim();
  const roots = override
    ? override.split(delimiter).map(expandHome).filter(Boolean)
    : [join(homedir(), '.claude')];

  if (!override) {
    const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
    if (configured) roots.push(expandHome(configured));

    try {
      for (const entry of readdirSync(homedir(), { withFileTypes: true })) {
        // profile 目录有时是符号链接，所以用 hasClaudeData() 跟随，
        // 而不是在这里要求 entry.isDirectory()。
        if (!/^\.claude-.+/.test(entry.name)) continue;
        const candidate = join(homedir(), entry.name);
        if (hasClaudeData(candidate)) roots.push(candidate);
      }
    } catch {
      // home 目录读取失败时，默认根与显式配置的根仍然可用。
    }
    roots.push(...findClaudeDesktopRoots([defaultClaudeDesktopDataDir()], onWarning));
  }

  const seen = new Set();
  const unique = [];
  for (const root of roots) {
    let canonical = root;
    try {
      canonical = realpathSync(root);
    } catch {
      // 缺失的显式/默认根保留下来，让调用方能正常报告。
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    unique.push(root);
  }
  return unique;
}

/** 存在的 projects/ 目录列表。 */
export function getProjectDirs() {
  const dirs = [];
  for (const root of getClaudeRoots()) {
    const candidate = join(root, 'projects');
    try {
      if (statSync(candidate).isDirectory()) dirs.push(candidate);
    } catch {
      // 缺失或不可读的根由扫描器统一处理。
    }
  }
  return dirs;
}
