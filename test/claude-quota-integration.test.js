import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'maclawd-claude-integration-'));
process.env.MACLAWD_DATA_DIR = root;
process.env.MACLAWD_CLAUDE_SETTINGS = join(root, 'claude-settings.json');
process.env.MACLAWD_CLAUDE_BIN = join(root, 'missing-claude');
process.env.MACLAWD_CLAUDE_DIRS = join(root, 'empty-claude');
process.env.MACLAWD_CODEX_HOME = join(root, 'empty-codex');
process.env.MACLAWD_WORKBUDDY_DIR = join(root, 'empty-workbuddy');
process.env.MACLAWD_GROK_DIR = join(root, 'empty-grok');
const { createUsageServer } = await import('../src/runtime/server.js');
const { createClaudeQuotaCollector, claudeQuotaReport } = await import('../src/runtime/claude-quota.js');
const { saveSettings, loadSettings } = await import('../src/runtime/settings.js');
const { recordQuota, readQuota, removeQuotaSource } = await import('../src/runtime/account-quota.js');
after(() => rmSync(root, { recursive: true, force: true }));
const raw = { rate_limits_available: true, subscription_type: 'max', rate_limits: {
  five_hour: { utilization: 71, resets_at: new Date(Date.now() + 3600_000).toISOString() },
  seven_day: { utilization: 29, resets_at: new Date(Date.now() + 86_400_000).toISOString() },
} };

async function serverFixture(t, worker) {
  const idle = { start() {}, stop() {}, refresh: async () => ({}), status: () => ({ installed: false }) };
  const { server } = createUsageServer({
    collector: { ...idle, live: () => ({}), scanNow: async () => ({}) },
    claudeQuotaCollector: worker, quotaCollector: idle, cursorQuotaCollector: idle,
    grokQuotaCollector: idle, workBuddyQuotaCollector: idle,
    kimiQuotaCollector: idle, kimiCodeQuotaCollector: idle, doubaoWorkQuotaCollector: idle,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200); return response.json();
  };
}

test('opening quota refreshes Claude, stale statusline cannot overwrite live limits, error preserves age', async (t) => {
  saveSettings({ quotaTracking: true, recordUsage: true });
  recordQuota({ source: 'claude-code', windows: { seven_day: { usedPercent: 28 } } }, { now: Date.now() - 32 * 60_000 });
  let fail = false, calls = 0, time = Date.now();
  const worker = createClaudeQuotaCollector({ now: () => time, installed: () => true,
    read: async () => { calls++; if (fail) throw Object.assign(new Error('private'), { code: 'ENODATA' });
      return claudeQuotaReport(raw); } });
  const request = await serverFixture(t, worker);
  await request('/api/quota'); await worker.refresh();
  let response = await request('/api/quota');
  assert.equal(calls, 1);
  let claude = response.sources.find(s => s.id === 'claude-code');
  assert.deepEqual(claude.windows.map(w => w.id), ['five_hour', 'seven_day']);
  assert.equal(claude.windows[1].usedPercent, 29);
  assert.ok(claude.windows[1].staleSeconds < 5);
  const seen = claude.windows[1].lastSeenAt;
  await request('/api/quota', { source: 'claude-code', completeSnapshot: true,
    windows: { seven_day: { usedPercent: 28 } }, context: { usedPercent: 50 } });
  claude = readQuota().sources.find(s => s.id === 'claude-code');
  assert.equal(claude.windows[1].usedPercent, 29);
  assert.equal(claude.windows[1].lastSeenAt, seen);
  assert.equal(claude.context.usedPercent, 50);
  time += 60_001; fail = true; await worker.refresh();
  response = await request('/api/quota');
  assert.equal(response.claude.lastError.code, 'ENODATA');
  assert.ok(!JSON.stringify(response.claude).includes('private'));
  assert.equal(readQuota().sources.find(s => s.id === 'claude-code').windows[1].lastSeenAt, seen);
  // When live acquisition fails, the existing statusline is a valid fallback again.
  await request('/api/quota', { source: 'claude-code', windows: { seven_day: { usedPercent: 30 } } });
  assert.equal(readQuota().sources.find(s => s.id === 'claude-code').windows[1].usedPercent, 30);
});

test('turning collection off cancels a running probe and turning it on restarts scheduling', async (t) => {
  saveSettings({ quotaTracking: true, recordUsage: true });
  let signal, finish;
  const worker = createClaudeQuotaCollector({ installed: () => true,
    read: ({ signal: s }) => { signal = s; return new Promise(resolve => { finish = resolve; }); } });
  const request = await serverFixture(t, worker);
  const pending = worker.refresh(); await Promise.resolve();
  await request('/api/settings', { recordUsage: false });
  assert.equal(signal.aborted, true);
  finish(claudeQuotaReport(raw)); assert.deepEqual(await pending, { discarded: true });
  assert.equal(worker.status().lastSuccessAt, null);
  await request('/api/settings', { recordUsage: true });
  assert.equal(worker.status().running, true);
  finish(claudeQuotaReport(raw)); await worker.refresh();
  await request('/api/settings', { quotaTracking: false });
  assert.equal(worker.status().running, false);
  assert.deepEqual(await worker.refresh(), { disabled: true });
});

test('custom statusline does not block active quota; a non-subscription response removes only Claude', async (t) => {
  saveSettings({ quotaTracking: false, recordUsage: true });
  writeFileSync(process.env.MACLAWD_CLAUDE_SETTINGS, JSON.stringify({ statusLine: { type: 'command', command: 'custom-untouched' } }));
  let calls = 0;
  const worker = createClaudeQuotaCollector({ installed: () => true,
    read: async () => { calls++; return claudeQuotaReport(raw); } });
  const request = await serverFixture(t, worker);
  const settings = await request('/api/settings', { quotaTracking: true });
  await worker.refresh();
  assert.equal(settings.settings.quotaTracking, true); assert.equal(calls, 1);
  assert.equal(settings.blocked, undefined); assert.equal(settings.error, undefined);
  assert.equal(worker.status().running, true);
  recordQuota({ source: 'codex', windows: { seven_day: { usedPercent: 33 } } });
  removeQuotaSource('claude-code');
  assert.ok(!readQuota().sources.some(s => s.id === 'claude-code'));
  assert.ok(readQuota().sources.some(s => s.id === 'codex'));
});

test('native decoder shows Claude refresh errors and cold-start loading independently of statusline', { skip: process.platform !== 'darwin' }, () => {
  const file = join(root, 'main.swift');
  writeFileSync(file, `import Foundation
let loading = QuotaSnapshot.decode(["sources": [], "claude": ["installed": true, "refreshing": true]])
precondition(loading.claudeMessage == "正在读取 Claude 订阅额度…")
let failed = QuotaSnapshot.decode(["claude": ["installed": true, "lastError": ["message": "Claude 额度查询超时"]]])
precondition(failed.claudeMessage == "Claude 额度查询超时")
let absent = QuotaSnapshot.decode(["claude": ["installed": false, "lastError": ["message": "missing"]]])
precondition(absent.claudeMessage == nil)
let live = QuotaSnapshot.decode(["sources": [["id": "claude-code", "windows": []]], "claude": ["installed": true, "refreshing": true]])
precondition(live.claudeMessage == nil)
`);
  const binary = join(root, 'native-contract');
  execFileSync('swiftc', ['mac/Sources/Maclawd/PanelModel.swift', 'mac/Sources/Maclawd/WorkBuddyInstallation.swift', file, '-o', binary]);
  execFileSync(binary);
});
