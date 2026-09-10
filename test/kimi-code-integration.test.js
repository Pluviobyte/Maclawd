import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'maclawd-kimi-status-'));
process.env.MACLAWD_DATA_DIR = root;
process.env.MACLAWD_CLAUDE_SETTINGS = join(root, 'claude-settings.json');
process.env.MACLAWD_CLAUDE_DIRS = join(root, 'empty-claude');
process.env.MACLAWD_CODEX_HOME = join(root, 'empty-codex');
process.env.MACLAWD_WORKBUDDY_DIR = join(root, 'empty-workbuddy');
process.env.MACLAWD_GROK_DIR = join(root, 'empty-grok');
const { createUsageServer } = await import('../src/runtime/server.js');
const { saveSettings, loadSettings } = await import('../src/runtime/settings.js');
const { recordQuota, readQuota } = await import('../src/runtime/account-quota.js');
const { createKimiCodeQuotaCollector, createKimiQuotaCollector, kimiMembershipReport } = await import('../src/runtime/kimi-quota.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('desktop stays healthy; CLI is not queried until opt-in and disappears cleanly on opt-out', async t => {
  saveSettings({ recordUsage: true, quotaTracking: true });
  assert.equal(loadSettings().kimiCodeQuotaTracking, false);
  recordQuota({ source: 'kimi-code', windows: { duration_10080: { usedPercent: 10 } } });
  recordQuota({ source: 'codex', windows: { seven_day: { usedPercent: 33 } } });
  let cliReads = 0;
  const cli = createKimiCodeQuotaCollector({ installed: () => true,
    read: async () => { cliReads++; throw Object.assign(new Error('PRIVATE'), { code: 'EAUTH' }); } });
  const desktop = createKimiQuotaCollector({ installed: () => true,
    read: async () => kimiMembershipReport({ subscriptionBalance: { amountUsedRatio: 0, expireTime: '2027-01-01T00:00:00Z' } }) });
  const idle = { start() {}, stop() {}, refresh: async () => ({}), status: () => ({ installed: false }) };
  const { server } = createUsageServer({ collector: { ...idle, live: () => ({}), scanNow: async () => ({}) },
    quotaCollector: idle, claudeQuotaCollector: idle, cursorQuotaCollector: idle,
    grokQuotaCollector: idle, workBuddyQuotaCollector: idle, doubaoWorkQuotaCollector: idle,
    kimiQuotaCollector: desktop, kimiCodeQuotaCollector: cli });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : {}); assert.equal(r.status, 200); return r.json();
  };
  await request('/api/quota'); await desktop.refresh();
  let quota = await request('/api/quota?refresh=false');
  assert.equal(cliReads, 0); assert.equal(quota.kimiCode.enabled, false);
  assert.equal(quota.kimi.lastError, null);
  assert.equal(quota.sources.find(s => s.id === 'kimi').windows[0].usedPercent, 0);
  assert.ok(!quota.sources.some(s => s.id === 'kimi-code'));
  assert.ok(quota.sources.some(s => s.id === 'codex'));
  await request('/api/settings', { kimiCodeQuotaTracking: true }); await cli.refresh();
  quota = await request('/api/quota?refresh=false');
  assert.equal(quota.kimiCode.enabled, true); assert.equal(cliReads, 1);
  assert.match(quota.kimiCode.lastError.message, /不影响 Kimi 桌面版登录/);
  assert.equal(quota.kimi.lastError, null);
  await request('/api/settings', { kimiCodeQuotaTracking: false });
  assert.equal(cli.status().running, false);
  await request('/api/quota'); assert.equal(cliReads, 1);
  assert.deepEqual(await request('/api/quota', { source: 'kimi-code', windows: { duration_10080: { usedPercent: 50 } } }), { ignored: true });
  assert.ok(!readQuota().sources.some(s => s.id === 'kimi-code'));
});

test('native status decoder keeps disabled CLI errors separate from healthy desktop', { skip: process.platform !== 'darwin' }, () => {
  const source = join(root, 'main.swift');
  writeFileSync(source, `import Foundation
let q = QuotaSnapshot.decode(["sources": [["id": "kimi", "windows": [["id": "total", "usedPercent": 0]]]],
  "kimi": ["enabled": true, "installed": true],
  "kimiCode": ["enabled": false, "installed": true, "lastError": ["message": "old CLI error"]]])
let desktop = q.desktopProviders.first { $0.id == "kimi" }!
let cli = q.desktopProviders.first { $0.id == "kimi-code" }!
precondition(desktop.enabled && desktop.errorMessage == nil)
precondition(!cli.enabled && cli.label == "Kimi Code CLI")
precondition(q.sources.first?.id == "kimi")
`);
  const binary = join(root, 'native');
  execFileSync('swiftc', ['mac/Sources/Maclawd/PanelModel.swift', 'mac/Sources/Maclawd/WorkBuddyInstallation.swift', source, '-o', binary]);
  execFileSync(binary);
  const panel = readFileSync('mac/Sources/Maclawd/PanelView.swift', 'utf8');
  assert.match(panel, /provider\.enabled && provider\.installed/);
  const settings = readFileSync('mac/Sources/Maclawd/PanelSettings.swift', 'utf8');
  assert.match(settings, /store\.bool\("kimiCodeQuotaTracking"\)/);
});
