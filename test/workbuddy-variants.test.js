import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as domestic from '../src/runtime/parsers/workbuddy.js';
import * as overseas from '../src/runtime/parsers/workbuddy-ai.js';
import { findWorkBuddyCredential, readWorkBuddyQuota } from '../src/runtime/workbuddy-quota.js';
import { installWorkBuddyHooks, uninstallWorkBuddyHooks, workBuddyHookStatus } from '../src/runtime/workbuddy-hook-install.js';
import { claudeJsonlEvent } from '../src/runtime/claude-session-monitor.js';

const editions = ['workbuddy', 'workbuddy-ai'];

test('两版使用独立日志根、来源及会话身份，即使调用 ID 相同', () => {
  assert.notDeepEqual(domestic.roots(), overseas.roots());
  const row = { timestamp: '2026-09-16T01:00:00Z', providerData: { messageId: 'same' }, message: { usage: { input_tokens: 10, output_tokens: 5 } } };
  assert.equal(domestic.parseObject(row).source, editions[0]);
  assert.equal(overseas.parseObject(row).source, editions[1]);
  const user = { type: 'user', sessionId: 'same', message: { content: 'hello' } };
  assert.equal(claudeJsonlEvent(user, {}, editions[0]).sessionId, 'same');
  assert.equal(claudeJsonlEvent(user, {}, editions[1]).sessionId, 'workbuddy-ai:same');
  assert.equal(claudeJsonlEvent({ ...user, sessionId: null }, {}, editions[1]), null);
});

test('身份只从当前版文件发现；登出或文件缺失不借用另一版', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-wb-identities-'));
  try {
    for (const [index, name] of ['workbuddy-desktop.info', 'workbuddy-desktop-ai.info'].entries()) {
      writeFileSync(join(root, name), JSON.stringify({ auth: { accessToken: `fake-${index}`, domain: index ? 'www.workbuddy.ai' : 'www.codebuddy.cn' } }));
    }
    for (const [index, source] of editions.entries()) {
      assert.equal(findWorkBuddyCredential({ source, authDirs: [root] }).accessToken, `fake-${index}`);
    }
    writeFileSync(join(root, 'workbuddy-desktop-ai.info.logged-out'), '');
    assert.equal(findWorkBuddyCredential({ source: editions[1], authDirs: [root] }), null);
    rmSync(join(root, 'workbuddy-desktop.info'));
    assert.equal(findWorkBuddyCredential({ source: editions[0], authDirs: [root] }), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('海外额度使用自身计费域名和来源，缺失或无效域名时不发送凭据', async () => {
  const report = await readWorkBuddyQuota({
    source: 'workbuddy-ai', credential: { accessToken: 'fake', domain: 'www.workbuddy.ai' },
    fetchImpl: async (url) => {
      assert.equal(new URL(url).hostname, 'www.workbuddy.ai');
      return { ok: true, text: async () => JSON.stringify({ data: { Response: { Data: { Accounts: [{ CapacityType: 4, CycleCapacityUsed: 20, CycleCapacitySize: 100, CycleCapacityRemain: 80, Status: 0 }] } } } }) };
    },
  });
  assert.equal(report.source, 'workbuddy-ai');
  assert.match(report.sourceLabel, /海外版/);
  for (const domain of [null, 'attacker.example']) {
    await assert.rejects(readWorkBuddyQuota({ source: 'workbuddy-ai', credential: { accessToken: 'fake', domain }, fetchImpl: () => assert.fail('must not send') }), { code: 'EDOMAIN' });
  }
});

test('两版 Hook 独立安装卸载，海外旧标记可修复且保留第三方配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-wb-hooks-'));
  const keys = ['MACLAWD_WORKBUDDY_SETTINGS', 'MACLAWD_WORKBUDDY_AI_SETTINGS'];
  const before = keys.map((key) => process.env[key]);
  keys.forEach((key, index) => { process.env[key] = join(root, `${index}.json`); });
  try {
    installWorkBuddyHooks();
    const domesticBytes = readFileSync(process.env[keys[0]], 'utf8');
    const legacy = JSON.parse(domesticBytes);
    legacy.hooks.Stop.push({ hooks: [{ type: 'command', command: 'third-party-hook' }] });
    writeFileSync(process.env[keys[1]], JSON.stringify(legacy));
    assert.equal(workBuddyHookStatus({ source: editions[1] }).installed.length, 0);
    installWorkBuddyHooks({ source: editions[1] });
    assert.equal(workBuddyHookStatus({ source: editions[1] }).missing.length, 0);
    assert.equal(readFileSync(process.env[keys[0]], 'utf8'), domesticBytes);
    uninstallWorkBuddyHooks({ source: editions[1] });
    assert.match(readFileSync(process.env[keys[1]], 'utf8'), /third-party-hook/);
    assert.equal(workBuddyHookStatus().missing.length, 0);
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    rmSync(root, { recursive: true, force: true });
  }
});

test('扫描升级会重建旧版合并缓存，两个同名日志不互相去重', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-wb-scan-'));
  const keys = ['MACLAWD_WORKBUDDY_DIR', 'MACLAWD_WORKBUDDY_AI_DIR', 'MACLAWD_DATA_DIR'];
  const before = keys.map((key) => process.env[key]);
  keys.forEach((key, index) => { process.env[key] = join(root, String(index)); });
  try {
    const { mkdirSync } = await import('node:fs');
    const { scanAll } = await import('../src/runtime/scan.js');
    const { writeJson } = await import('../src/runtime/store.js');
    for (const [index, key] of keys.slice(0, 2).entries()) {
      mkdirSync(process.env[key], { recursive: true });
      writeFileSync(join(process.env[key], 'same.jsonl'), JSON.stringify({
        timestamp: '2026-09-16T01:00:00Z', providerData: { messageId: 'same' },
        message: { usage: { input_tokens: 10 + index, output_tokens: 5 } },
      }) + '\n');
    }
    writeJson('scan-cache.json', { v: 18, files: { '/old/merged': { source: 'workbuddy', packed: [] } } });
    for (let i = 0; i < 2; i++) {
      const result = await scanAll({ parsers: [domestic, overseas] });
      assert.equal(result.records.length, 2);
      assert.equal(result.bySource.workbuddy[0].input, 10);
      assert.equal(result.bySource['workbuddy-ai'][0].input, 11);
    }
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    rmSync(root, { recursive: true, force: true });
  }
});
