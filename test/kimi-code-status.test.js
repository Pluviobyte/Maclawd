import test from 'node:test';
import assert from 'node:assert/strict';
import { createKimiCodeQuotaCollector } from '../src/runtime/kimi-quota.js';

test('a leftover CLI profile must not start independent Kimi Code quota collection by default', async () => {
  let reads = 0;
  const collector = createKimiCodeQuotaCollector({
    settings: () => ({ recordUsage: true, quotaTracking: true }),
    installed: () => true,
    read: async () => { reads++; throw Object.assign(new Error('private'), { code: 'EAUTH' }); },
  });
  assert.deepEqual(await collector.refresh(), { disabled: true });
  assert.equal(reads, 0);
  assert.equal(collector.status().enabled, false);
});

const report = { source: 'kimi-code', windows: { duration_10080: { usedPercent: 12 } } };

test('explicit CLI opt-in fetches its quota and labels authentication failure as CLI-only', async () => {
  const settings = () => ({ recordUsage: true, quotaTracking: true, kimiCodeQuotaTracking: true });
  let saved;
  const success = createKimiCodeQuotaCollector({ settings, installed: () => true,
    read: async () => report, record: (r) => { saved = r; } });
  await success.refresh(); assert.equal(saved, report); assert.equal(success.status().enabled, true);
  const failed = createKimiCodeQuotaCollector({ settings, installed: () => true,
    read: async () => { throw Object.assign(new Error('SECRET'), { code: 'EAUTH' }); } });
  const result = await failed.refresh();
  assert.match(result.error.message, /独立 Kimi Code CLI/);
  assert.match(result.error.message, /不影响 Kimi 桌面版登录/);
  assert.doesNotMatch(result.error.message, /已过期|请在官方应用中刷新登录|SECRET/);
});

test('switching CLI collection off during a request discards both late data and late errors', async () => {
  let active = true, finish, records = 0;
  const collector = createKimiCodeQuotaCollector({ installed: () => true,
    settings: () => ({ recordUsage: true, quotaTracking: true, kimiCodeQuotaTracking: active }),
    read: () => new Promise((_, reject) => { finish = reject; }), record: () => records++ });
  const pending = collector.refresh(); await Promise.resolve(); active = false;
  finish(Object.assign(new Error('SECRET'), { code: 'EAUTH' }));
  assert.deepEqual(await pending, { discarded: true });
  assert.equal(records, 0); assert.equal(collector.status().lastError, null);
  assert.equal(collector.status().enabled, false);
});

test('installation detection accepts modern and legacy executable paths, not a profile directory', async () => {
  const { isKimiCodeInstalled } = await import('../src/runtime/kimi-quota.js');
  const home = '/fixture';
  const testPath = (path, env = {}) => isKimiCodeInstalled({ home, env, executable: p => p === path });
  assert.equal(testPath('/fixture/.kimi-code'), false);
  assert.equal(testPath('/fixture/.kimi-code/bin/kimi'), true);
  assert.equal(testPath('/fixture/.local/bin/kimi'), true);
  assert.equal(testPath('/custom/bin/kimi', { KIMI_CODE_HOME: '/custom' }), true);
  assert.equal(testPath('/fixture/.local/bin/kimi', { MACLAWD_KIMI_CODE_BIN: '/absent' }), false);
});
