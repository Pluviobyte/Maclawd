import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Agent 注册表把 WorkBuddy 暴露为无权限接管的实时来源', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-workbuddy-registry-'));
  const data = join(root, 'projects');
  mkdirSync(data, { recursive: true });
  process.env.MACLAWD_WORKBUDDY_DIR = data;
  process.env.MACLAWD_WORKBUDDY_SETTINGS = join(root, 'settings.json');
  try {
    const { agentConnections, runAgentDoctor } = await import(
      `../src/runtime/agent-registry.js?workbuddy=${Date.now()}`
    );
    const workBuddy = agentConnections().find((agent) => agent.id === 'workbuddy');
    assert.equal(workBuddy.installed, true);
    assert.equal(workBuddy.capabilities.realtime, true);
    assert.equal(workBuddy.capabilities.permissions, false);
    assert.equal(workBuddy.capabilities.quota, false, 'Hooks 不等于积分数据，不能误报额度能力');
    assert.equal(workBuddy.integration.status, 'available');

    const doctor = runAgentDoctor({ workBuddyHookEnhancement: true });
    const check = doctor.checks.find((item) => item.agentId === 'workbuddy');
    assert.equal(check.level, 'warning');
    assert.equal(check.repairable, true);
  } finally {
    delete process.env.MACLAWD_WORKBUDDY_DIR;
    delete process.env.MACLAWD_WORKBUDDY_SETTINGS;
    rmSync(root, { recursive: true, force: true });
  }
});
