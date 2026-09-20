import { execFileSync } from 'node:child_process';

// Product identity, separate from usage capability. A registered application is
// not evidence that its private logs or quota protocol are supported.
export const APPLICATIONS = {
  'claude-code': { bundleIds: ['com.anthropic.claudefordesktop'], scope: '用量按 Cowork 与 Code 入口展示；Code 的 CLI／桌面共享目录无法进一步可靠区分。订阅额度共用。' },
  codex: { bundleIds: ['com.openai.codex'], scope: '用量按日志标识区分桌面、CLI、编辑器扩展与非交互调用；无法归属的保留在 Codex。订阅额度共用。' },
  workbuddy: { bundleIds: ['com.workbuddy.workbuddy'], scope: '国内版独立日志、Hook 与登录身份。' },
  'workbuddy-ai': { bundleIds: ['com.workbuddy.workbuddy-ai'], scope: '海外版独立日志、Hook 与登录身份。' },
  cursor: { bundleIds: ['com.todesktop.230313mzl4w4u92'], scope: '仅 Cursor 本身；不借用 Grok Bot 登录或数据。' },
  antigravity: { bundleIds: ['com.google.antigravity'], scope: '桌面和 CLI 用量按目录区分；复制记录先去重再归属。' },
  mcode: { bundleIds: ['com.minimax.agent'], scope: 'MiniMax Code 本地用量账本；桌面与 CLI 共享账本，不能可靠拆分。与 MiMoCode 独立。' },
  cindy: { bundleIds: ['com.xd.cindycn'], scope: '国内版 Codex/Pi 日用量账本；Claude 使用原生日志，避免重复计数。' },
  'cindy-global': { bundleIds: ['com.xd.cindy'], scope: '海外版独立日用量账本；日累计量不用于推测单次上下文长度。' },
  qoder: { scope: '海外版 IDE SQLite 与 CLI JSONL 用量；积分不换算为 Token。' },
  'qoder-cn': { scope: '国内版独立 IDE / CLI 用量，与海外版身份分开。' },
  cola: { scope: 'Cola 桌面与 CLI 共用的 Pi 会话；复制的历史记录去重。' },
  'kimi-code': { scope: 'CLI 与 Kimi 桌面内置运行时的用量分别展示；CLI 额度读取仍使用独立登录身份。' },
  codebuddy: { scope: 'CodeBuddy Code CLI 独立会话；不混入国内或海外 WorkBuddy。' },
  'codearts-agent': { scope: 'CodeArts Agent 本地用量；独立于 OpenCode，暂无订阅额度接口。' },
  devin: { scope: 'Devin CLI 与桌面共享本地账本；ACU 和积分不换算成 Token 或美元。' },
  kiro: { scope: '仅 Kiro CLI 的实际 Token 用量；不包含 Kiro IDE 或文字估算。' },
  cline: { scope: '用量按编辑器宿主与独立运行时区分；同一任务副本先去重。' },
  'roo-code': { scope: '用量按编辑器宿主区分；与 Cline 独立。' },
  'trae-cli': { scope: '仅 Trae CLI 遥测；不包含 TRAE SOLO 或 IDE 自身对话。' },
  grok: { scope: '仅 .grok 中的 Grok Build；不包含 Grok Bot 桌面。' },
};
export const OTHER_APPLICATIONS = [
  { id: 'kimi', label: 'Kimi 桌面', bundleIds: ['com.moonshot.kimichat'], quota: true, scope: '桌面订阅额度；内置运行时的 Token 在 Kimi Code 桌面来源中展示，服务地区跟随官方登录。' },
  { id: 'doubao-work', label: '豆包工作', bundleIds: ['com.work.pc.doubao'], quota: true, scope: '仅豆包工作订阅额度；尚无本地 Token 统计。' },
  { id: 'doubao', label: '豆包', bundleIds: ['com.bot.pc.doubao'], scope: '已识别普通豆包；用量与额度尚未接入，不复用豆包工作身份。' },
  { id: 'grok-bot', label: 'Grok Bot', bundleIds: ['com.anysphere.sand'], scope: '已独立识别；尚无经核实的用量接口，不归入 Cursor 或 Grok Build。' },
  { id: 'trae-solo-cn', label: 'TRAE SOLO（国内版）', bundleIds: ['cn.trae.solo.app'], scope: '已独立识别；本地对话存储不是可直接读取的 SQLite，用量尚未接入。' },
];
let cached = null;
let cachedAt = 0;
export function registeredApplications({ platform = process.platform, now = Date.now(), run = execFileSync } = {}) {
  if (platform !== 'darwin') return new Set();
  if (run === execFileSync && cached && now - cachedAt < 60_000) return new Set(cached);
  const ids = [...new Set([...Object.values(APPLICATIONS), ...OTHER_APPLICATIONS].flatMap(a => a.bundleIds ?? []))];
  // AppKit only: no Apple Events, keychain, credentials, app launching or UI control.
  const script = `ObjC.import('AppKit'); JSON.stringify(${JSON.stringify(ids)}.filter(id => !$.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(id).isNil()));`;
  try {
    const value = JSON.parse(String(run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024 })));
    const result = new Set(Array.isArray(value) ? value.filter(id => ids.includes(id)) : []);
    if (run === execFileSync) { cached = [...result]; cachedAt = now; }
    return result;
  } catch { return new Set(); }
}
export function installationEvidence(descriptor, hasLocalData, registered) {
  const app = descriptor?.bundleIds?.some(id => registered.has(id)) ?? false;
  return { installed: app || hasLocalData, hasLocalData,
    installation: app ? 'application' : hasLocalData ? 'data-only' : 'not-found' };
}
