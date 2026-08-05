import { existsSync } from 'node:fs';
import { parsers, VERIFIED_SOURCES } from './parsers/index.js';
import { hookStatus, permissionHookStatus } from './hook-install.js';
import { codexHookStatus } from './codex-hook-install.js';

const REALTIME = new Set(['claude-code', 'codex']);

export function agentConnections() {
  const claude = hookStatus();
  const codex = codexHookStatus();
  return parsers.map((parser) => {
    const realtime = REALTIME.has(parser.id);
    const status = parser.id === 'claude-code' ? claude : parser.id === 'codex' ? codex : null;
    const ready = status ? status.missing.length === 0 : false;
    return {
      id: parser.id,
      label: parser.label,
      installed: parser.dataDirs().some(existsSync),
      verified: VERIFIED_SOURCES.has(parser.id),
      capabilities: {
        usage: true,
        realtime,
        permissions: realtime,
        terminalFocus: realtime,
        quota: realtime,
      },
      integration: realtime ? {
        status: ready ? 'connected' : status.installed?.length ? 'partial' : 'available',
        installedEvents: status.installed?.length ?? 0,
        missingEvents: status.missing?.length ?? 0,
        permissionInstalled: parser.id === 'claude-code'
          ? permissionHookStatus().installed
          : status.permissionInstalled,
        trustReviewRequired: status.trustReviewRequired === true,
        error: status.error ?? null,
      } : { status: 'usage-only' },
    };
  });
}

export function runAgentDoctor(settings = {}) {
  const agents = agentConnections().filter((a) => a.capabilities.realtime);
  const checks = [];
  for (const agent of agents) {
    const expected = agent.id === 'codex' ? settings.codexHookEnhancement : settings.hookEnhancement;
    checks.push({
      id: `${agent.id}:realtime`,
      agentId: agent.id,
      label: `${agent.label} 实时事件`,
      level: !expected || agent.integration.status === 'connected' ? 'ok' : 'warning',
      message: !expected ? '未启用' : agent.integration.status === 'connected'
        ? '已连接' : `缺少 ${agent.integration.missingEvents} 个 hook`,
      repairable: expected && agent.integration.status !== 'connected',
    });
    if (settings.permissionBubble === true) {
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
  return { summary: warnings ? `${warnings} 项需要修复` : '连接正常', warnings, checks };
}
