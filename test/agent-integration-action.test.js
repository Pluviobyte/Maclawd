import test from 'node:test';
import assert from 'node:assert/strict';
import { changeAgentIntegration } from '../src/runtime/agent-integration-action.js';

function fakeAgent(external) {
  return {
    settingKey: 'workBuddyHookEnhancement',
    install: () => { external.enabled = true; },
    uninstall: () => { external.enabled = false; },
  };
}

test('Agent 外部配置修改成功后才提交本地开关', () => {
  const external = { enabled: false };
  let saved = null;
  const result = changeAgentIntegration('workbuddy', 'install', {
    agents: { workbuddy: fakeAgent(external) },
    load: () => ({ workBuddyHookEnhancement: false, permissionBubble: false }),
    save: (patch) => { saved = patch; return patch; },
  });
  assert.equal(external.enabled, true);
  assert.deepEqual(saved, { workBuddyHookEnhancement: true });
  assert.deepEqual(result.settings, saved);
});

test('本地开关保存失败时把 WorkBuddy 外部配置恢复到修改前', () => {
  const external = { enabled: false };
  assert.throws(() => changeAgentIntegration('workbuddy', 'install', {
    agents: { workbuddy: fakeAgent(external) },
    load: () => ({ workBuddyHookEnhancement: false, permissionBubble: false }),
    save: () => { throw new Error('settings disk full'); },
  }), /settings disk full/);
  assert.equal(external.enabled, false, '不能留下 Hook 已装、开关未保存的分裂状态');
});

test('外部配置操作失败时同样恢复原状态且不保存开关', () => {
  const external = { enabled: true };
  let saved = false;
  const agent = fakeAgent(external);
  agent.uninstall = () => { external.enabled = false; throw new Error('write failed'); };
  assert.throws(() => changeAgentIntegration('workbuddy', 'uninstall', {
    agents: { workbuddy: agent },
    load: () => ({ workBuddyHookEnhancement: true, permissionBubble: false }),
    save: () => { saved = true; },
  }), /write failed/);
  assert.equal(external.enabled, true);
  assert.equal(saved, false);
});
