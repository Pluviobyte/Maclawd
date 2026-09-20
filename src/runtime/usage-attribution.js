// Attribution never changes the accounting identity. Rollup selects a display
// source only AFTER canonical deduplication (including Codex replay handling).
const hosts = {
  Code: 'VS Code', 'Code - Insiders': 'VS Code Insiders', VSCodium: 'VSCodium',
  Cursor: 'Cursor', Windsurf: 'Windsurf', Trae: 'Trae（海外版）', 'Trae CN': 'Trae（国内版）',
};
export const ATTRIBUTION_LABELS = {
  'kimi-code:desktop': 'Kimi Code 桌面', 'kimi-code:cli': 'Kimi Code CLI',
  'claude-code:cowork': 'Claude Cowork',
  'claude-code:local': 'Claude Code（CLI／Code，未区分）',
  'codex:cli': 'Codex CLI', 'codex:desktop': 'Codex 桌面',
  'codex:vscode': 'Codex 编辑器扩展', 'codex:integration': 'Codex · 外部集成', 'codex:exec': 'Codex 非交互调用',
  'antigravity:desktop': 'Antigravity 桌面', 'antigravity:cli': 'Antigravity CLI',
  ...Object.fromEntries(['cline', 'roo-code'].flatMap(source => Object.entries(hosts)
    .map(([host, label]) => [`${source}:host:${host}`, `${source === 'cline' ? 'Cline' : 'Roo Code'} · ${label}`]))),
  'cline:standalone': 'Cline 独立版（CLI／桌面）',
};
export function displaySource(record) {
  return record.usageSource && Object.hasOwn(ATTRIBUTION_LABELS, record.usageSource)
    && record.usageSource.startsWith(`${record.source}:`) ? record.usageSource : record.source;
}
export function pathAttribution(source, path) {
  const parts = String(path ?? '').split(/[\\/]/);
  if (source === 'kimi-code') return parts.includes('daimon-share') ? 'kimi-code:desktop' : 'kimi-code:cli';
  if (source === 'claude-code') {
    return parts.includes('local-agent-mode-sessions') ? 'claude-code:cowork' : 'claude-code:local';
  }
  if (source === 'antigravity') {
    if (parts.includes('antigravity-cli')) return 'antigravity:cli';
    if (parts.includes('antigravity')) return 'antigravity:desktop';
  }
  if (source === 'cline' || source === 'roo-code') {
    const userIndex = parts.lastIndexOf('User');
    const host = userIndex > 0 ? parts[userIndex - 1] : null;
    if (Object.hasOwn(hosts, host)) return `${source}:host:${host}`;
    if (source === 'cline' && parts.includes('.cline')) return 'cline:standalone';
  }
  return null;
}
export function codexAttribution(meta) {
  // The desktop app also writes SessionSource::VSCode: originator must
  // positively identify the desktop app. Unknown integrations stay in the parent source.
  if (meta?.originator === 'Codex Desktop') return 'codex:desktop';
  if (meta?.originator === 'Claude Code') return 'codex:integration';
  if (meta?.source === 'cli') return 'codex:cli';
  if (meta?.source === 'vscode') return 'codex:vscode';
  if (meta?.source === 'exec') return 'codex:exec';
  return null;
}
