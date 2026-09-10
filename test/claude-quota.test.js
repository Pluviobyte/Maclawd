import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_QUOTA_ARGS, claudeQuotaEnvironment, discoverClaudeBinaries,
  claudeQuotaReport, probeClaudeUsage, readClaudeQuota, createClaudeQuotaCollector } from '../src/runtime/claude-quota.js';

const payload = (used = 29) => ({ subscription_type: 'pro', rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 71, resets_at: '2026-09-10T08:09:59.765+00:00' },
    seven_day: { utilization: used, resets_at: '2026-09-11T10:59:59Z' } } });
const error = (code) => Object.assign(new Error('secret stderr must not escape'), { code });

test('official quota windows keep units/order; missing/null values are not zero', () => {
  const report = claudeQuotaReport(payload());
  assert.deepEqual(Object.keys(report.windows), ['five_hour', 'seven_day']);
  assert.equal(report.windows.five_hour.usedPercent, 71);
  assert.equal(report.windows.five_hour.resetAt, Date.parse('2026-09-10T08:09:59.765Z'));
  assert.equal(report.planType, 'pro');
  assert.equal(report.completeSnapshot, true);
  assert.equal(report.sessionCostUsd, undefined, 'probe cost must not replace the real working session cost');
  for (const value of [null, '29', false, -1, 101, Infinity]) {
    const raw = payload(value); assert.throws(() => claudeQuotaReport(raw), { code: 'EPROTO' });
  }
  const partial = payload(); partial.rate_limits.seven_day = null;
  assert.deepEqual(Object.keys(claudeQuotaReport(partial).windows), ['five_hour']);
  const zero = payload(0); assert.equal(claudeQuotaReport(zero).windows.seven_day.usedPercent, 0);
  for (const plan of ['pro', 'max', 'team', 'enterprise']) {
    assert.equal(claudeQuotaReport({ ...payload(), subscription_type: plan }).planType, plan);
  }
  assert.throws(() => claudeQuotaReport({ rate_limits_available: false }), { code: 'ENOTAPPLICABLE' });
  assert.throws(() => claudeQuotaReport({ rate_limits_available: true, rate_limits: null }), { code: 'ENODATA' });
  const invalid = payload(); invalid.rate_limits.five_hour.resets_at = 1789027800;
  assert.throws(() => claudeQuotaReport(invalid), { code: 'EPROTO' });
});

test('probe environment isolates nested sessions and settings override without changing profile', () => {
  const original = { CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/custom',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', PATH: '/bin', EXTRA: 'preserve' };
  const child = claudeQuotaEnvironment(original);
  assert.equal(child.CLAUDECODE, undefined);
  assert.equal(child.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, undefined);
  assert.equal(child.CLAUDE_CONFIG_DIR, '/custom');
  assert.equal(original.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  for (const flag of ['--print', '--safe-mode', '--no-session-persistence', '--strict-mcp-config']) {
    assert.ok(CLAUDE_QUOTA_ARGS.includes(flag));
  }
  assert.equal(CLAUDE_QUOTA_ARGS[CLAUDE_QUOTA_ARGS.indexOf('--tools') + 1], '');
  const settings = JSON.parse(CLAUDE_QUOTA_ARGS[CLAUDE_QUOTA_ARGS.indexOf('--settings') + 1]);
  assert.deepEqual(settings, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '' } });
  assert.ok(!CLAUDE_QUOTA_ARGS.includes('--bare'));
});

test('binary discovery prefers CLI, deduplicates symlinks, and selects latest Desktop numerically', () => {
  const home = '/fixture';
  const root = `${home}/Library/Application Support/Claude/claude-code`;
  const latest = `${root}/2.1.260/claude.app/Contents/MacOS/claude`;
  const paths = new Set([`${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', latest,
    `${root}/2.1.9/claude.app/Contents/MacOS/claude`]);
  const options = { home, env: {}, executable: (p) => paths.has(p),
    list: () => ['2.1.9', '2.1.260', '../malicious', 'junk'],
    canonical: (p) => p === '/opt/homebrew/bin/claude' ? `${home}/.local/bin/claude` : p };
  assert.deepEqual(discoverClaudeBinaries(options), [`${home}/.local/bin/claude`, latest]);
  assert.deepEqual(discoverClaudeBinaries({ ...options, env: { MACLAWD_CLAUDE_BIN: '/missing' } }), []);
  paths.delete(`${home}/.local/bin/claude`); paths.delete('/opt/homebrew/bin/claude');
  assert.deepEqual(discoverClaudeBinaries(options), [latest]);
});

function fixture(t, body) {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-claude-probe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'claude');
  writeFileSync(path, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return path;
}

test('real child protocol exchange sends no prompt, tolerates chunked responses and ignores unrelated IDs', async (t) => {
  const command = fixture(t, `
const readline = require('node:readline');
const send = (request_id, response) => JSON.stringify({type:'control_response', response:{subtype:'success',request_id,response}})+'\\n';
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.type!=='control_request') process.exit(21);
 if(m.request.subtype==='initialize') {
  process.stdout.write(send('other',{}));
  process.stdout.write(send(m.request_id,{}));
 } else if(m.request.subtype==='get_usage' && m.request.skip_behaviors===true) {
  const line=send(m.request_id,${JSON.stringify(payload())});
  process.stdout.write(line.slice(0,20));setTimeout(()=>process.stdout.write(line.slice(20)),5);
 } else process.exit(22);
});`);
  const raw = await probeClaudeUsage(command, { timeoutMs: 10_000 });
  assert.deepEqual(raw, payload());
});

test('probe bounds a silent child, handles abort/early exit, and never exposes stderr', async (t) => {
  const silent = fixture(t, "setInterval(()=>{},1000)");
  await assert.rejects(probeClaudeUsage(silent, { timeoutMs: 80 }), { code: 'ETIMEDOUT' });
  const abort = new AbortController();
  const pending = probeClaudeUsage(silent, { signal: abort.signal }); abort.abort();
  await assert.rejects(pending, { code: 'EABORT' });
  await assert.rejects(probeClaudeUsage(silent, { signal: abort.signal }), { code: 'EABORT' });
  const exited = fixture(t, "process.stderr.write('private-secret');process.exit(1)");
  await assert.rejects(probeClaudeUsage(exited), (e) => e.code === 'EPROCESS' && !e.message.includes('secret'));
  const flooding = fixture(t, "process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000)");
  await assert.rejects(probeClaudeUsage(flooding), { code: 'EPROTO' });
});

test('fallback shares one time budget; non-subscription and cancellation stop candidate retries', async () => {
  let time = 0; const calls = [];
  const options = { discover: () => ['cli', 'desktop', 'older'], clock: () => time,
    timeoutMs: 100, candidateTimeoutMs: 80,
    probe: async (bin, options) => { calls.push([bin, options.timeoutMs]); time += 80; throw error('ETIMEDOUT'); } };
  await assert.rejects(readClaudeQuota(options), { code: 'ETIMEDOUT' });
  assert.deepEqual(calls, [['cli', 80], ['desktop', 20]]);
  let count = 0;
  await assert.rejects(readClaudeQuota({ discover: () => ['cli', 'desktop'], probe: async () => {
    count++; return { rate_limits_available: false };
  } }), { code: 'ENOTAPPLICABLE' });
  assert.equal(count, 1);
  const report = await readClaudeQuota({ discover: () => ['cli', 'desktop'], probe: async (bin) => {
    if (bin === 'cli') throw error('EPROCESS'); return payload();
  } });
  assert.equal(report.windows.seven_day.usedPercent, 29);
});

test('collector deduplicates, caches, backs off errors and preserves success freshness', async () => {
  let time = 0, calls = 0, fail = false, records = [];
  const collector = createClaudeQuotaCollector({ enabled: () => true, installed: () => true,
    now: () => time, cacheMs: 100, maxBackoffMs: 800, record: (x) => records.push(x),
    read: async () => { calls++; if (fail) throw error('ENODATA'); return claudeQuotaReport(payload()); } });
  const a = collector.refresh(); assert.equal(a, collector.refresh()); await a;
  await collector.refresh(); assert.equal(calls, 1);
  time = 100; fail = true; await collector.refresh();
  assert.equal(collector.status().lastSuccessAt, 0);
  assert.equal(collector.status().nextAttemptAt, 200);
  await collector.refresh({ force: true }); assert.equal(calls, 2);
  time = 200; await collector.refresh(); assert.equal(collector.status().nextAttemptAt, 400);
  time = 400; fail = false; await collector.refresh();
  assert.equal(collector.status().lastSuccessAt, 400);
  assert.equal(collector.status().lastError, null);
  assert.equal(records.length, 2);
});

test('disabled and stopped collectors cannot publish late results or overwrite a new flight', async () => {
  let enabled = true, finish, recorded = 0;
  const collector = createClaudeQuotaCollector({ enabled: () => enabled, installed: () => false,
    read: () => new Promise(resolve => { finish = resolve; }), record: () => recorded++ });
  const a = collector.refresh(); await Promise.resolve();
  collector.stop(); enabled = false; finish(claudeQuotaReport(payload())); await a;
  assert.equal(recorded, 0);
  assert.deepEqual(await collector.refresh(), { disabled: true });
  enabled = true; const b = collector.refresh({ force: true }); await Promise.resolve();
  finish(claudeQuotaReport(payload())); await b; assert.equal(recorded, 1);
});

test('official non-subscription response clears only through the supplied unavailable callback', async () => {
  let cleared = 0;
  const collector = createClaudeQuotaCollector({ enabled: () => true, installed: () => true,
    read: async () => { throw error('ENOTAPPLICABLE'); }, unavailable: () => cleared++ });
  const result = await collector.refresh();
  assert.equal(cleared, 1); assert.equal(result.error.code, 'ENOTAPPLICABLE');
  assert.ok(!JSON.stringify(result).includes('secret'));
});
