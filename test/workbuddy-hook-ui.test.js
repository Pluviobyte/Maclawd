import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelSettings.swift', import.meta.url), 'utf8',
);
const action = readFileSync(
  new URL('../src/runtime/agent-integration-action.js', import.meta.url), 'utf8',
);

test('Agent 连接面板管理 WorkBuddy 集成并说明配置与权限边界', () => {
  // 设置页通过 agentAction 管理 WorkBuddy 连接
  assert.match(settings, /agentAction/);
  // 集成动作注册了 WorkBuddy 的设置键
  assert.match(action, /workBuddyHookEnhancement/);
  // 说明不覆盖配置、不处理权限
  assert.match(settings, /不覆盖已有配置/);
  assert.match(settings, /不处理权限/);
});
