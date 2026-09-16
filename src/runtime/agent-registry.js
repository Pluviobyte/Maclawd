import { APPLICATIONS, OTHER_APPLICATIONS, registeredApplications, installationEvidence } from './application-catalog.js';
import { existsSync } from 'node:fs';
import { parsers, VERIFIED_SOURCES } from './parsers/index.js';
import { hookStatus, permissionHookStatus } from './hook-install.js';
import { codexHookStatus } from './codex-hook-install.js';
import { workBuddyHookStatus } from './workbuddy-hook-install.js';
import { cursorHookStatus } from './cursor-hook-install.js';

const REALTIME = new Set(['claude-code', 'codex', 'workbuddy', 'workbuddy-ai']);
const MANAGED = new Set([...REALTIME, 'cursor']);

export function agentConnections({ registered = registeredApplications() } = {}) {
  const claude = hookStatus();
  const codex = codexHookStatus();
  const workBuddy = workBuddyHookStatus();
  const cursor = cursorHookStatus();
  const workBuddyAI = workBuddyHookStatus({ source: 'workbuddy-ai' });
  const connections = parsers.map((parser) => {
    const realtime = REALTIME.has(parser.id);
    const status = parser.id === 'claude-code' ? claude
      : parser.id === 'codex' ? codex
        : parser.id === 'workbuddy-ai' ? workBuddyAI
        : parser.id === 'workbuddy' ? workBuddy
          : parser.id === 'cursor' ? cursor : null;
    const ready = status ? status.missing.length === 0 : false;
    return {
      id: parser.id,
      label: parser.label,
      ...installationEvidence(APPLICATIONS[parser.id], parser.dataDirs().some(existsSync), registered),
      scope: APPLICATIONS[parser.id]?.scope ?? '仅此来源支持的本地用量；不代表支持所有同名桌面或网页产品。',
      verified: VERIFIED_SOURCES.has(parser.id),
      capabilities: {
        usage: true,
        realtime,
        localCapture: parser.id === 'cursor',
        permissions: realtime && !['workbuddy', 'workbuddy-ai'].includes(parser.id),
        terminalFocus: realtime,
        // WorkBuddy 额度来自本机登录凭据 + 计费查询，不依赖 Hooks 是否开启。
        quota: parser.id === 'claude-code' || parser.id === 'codex' || ['workbuddy', 'workbuddy-ai'].includes(parser.id),
      },
      integration: MANAGED.has(parser.id) ? {
        status: ready ? 'connected' : status.installed?.length ? 'partial' : 'available',
        installedEvents: status.installed?.length ?? 0,
        missingEvents: status.missing?.length ?? 0,
        permissionInstalled: ['workbuddy', 'workbuddy-ai'].includes(parser.id) ? false : parser.id === 'claude-code'
          ? permissionHookStatus().installed
          : status.permissionInstalled,
        trustReviewRequired: status.trustReviewRequired === true,
        error: status.error ?? null,
      } : { status: 'usage-only' },
    };
  });
  for (const app of OTHER_APPLICATIONS) {
    const evidence = installationEvidence(app, false, registered);
    if (!evidence.installed) continue;
    connections.push({ id: app.id, label: app.label, ...evidence, scope: app.scope, verified: false,
      capabilities: { usage: false, realtime: false, localCapture: false, permissions: false,
        terminalFocus: false, quota: app.quota === true },
      integration: { status: app.quota ? 'quota-only' : 'unsupported' } });
  }
  return connections;
}

export function runAgentDoctor(settings = {}) {
  const agents = agentConnections().filter((a) => MANAGED.has(a.id));
  const checks = [];
  for (const agent of agents) {
    const expected = agent.id === 'codex' ? settings.codexHookEnhancement
      : agent.id === 'workbuddy-ai' ? settings.workBuddyAIHookEnhancement
      : agent.id === 'workbuddy' ? settings.workBuddyHookEnhancement
        : agent.id === 'cursor' ? settings.cursorHookEnhancement
          : settings.hookEnhancement;
    const checkLabel = agent.id === 'cursor'
      ? `${agent.label} 本地精确用量` : `${agent.label} 实时事件`;
    checks.push({
      id: `${agent.id}:realtime`,
      agentId: agent.id,
      label: checkLabel,
      level: !expected || agent.integration.status === 'connected' ? 'ok' : 'warning',
      message: !expected ? '未启用' : agent.integration.status === 'connected'
        ? '已连接' : `缺少 ${agent.integration.missingEvents} 个 hook`,
      repairable: expected && agent.integration.status !== 'connected',
    });
    if (settings.permissionBubble === true && agent.capabilities.permissions) {
      checks.push({
        id: `${agent.id}:permission`, agentId: agent.id, label: `${agent.label} 权限卡片`,
        level: agent.integration.permissionInstalled ? 'ok' : 'warning',
        message: agent.integration.permissionInstalled ? '已连接' : '权限 hook 缺失',
        repairable: !agent.integration.permissionInstalled,
      });
    }
    if (agent.id === 'codex' && agent.integration.trustReviewRequired) {
      checks.push({
        id: 'codex:trust', agentId: 'codex', label: 'Codex hook 信任', level: 'info',
        message: '请在 Codex /hooks 中确认一次；配置文件无法验证该信任状态', repairable: false,
      });
    }
  }
  const warnings = checks.filter((c) => c.level === 'warning').length;
  return { summary: warnings ? `${warnings} 项需要修复` : '已启用的 Agent 连接配置完整', warnings, checks };
}
