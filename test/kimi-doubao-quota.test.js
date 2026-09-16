import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { kimiMembershipReport, kimiCodeReport, readKimiMembershipQuota, readKimiCodeAuth, readKimiCodeQuota } from '../src/runtime/kimi-quota.js';
import { doubaoWorkQuotaReport, readDoubaoWorkQuota } from '../src/runtime/doubao-work-quota.js';
import { decryptMacStorage, readKimiDesktopAuth, readDoubaoWorkAuth, readDesktopStoragePassword } from '../src/runtime/desktop-quota-auth.js';
import { createProviderQuotaCollector } from '../src/runtime/provider-quota-collector.js';
import { quotaJson } from '../src/runtime/quota-client.js';

// Protocol references: MoonshotAI/kimi-code@2da4aa23, CodexBar@5c0d7b4,
// Chromium v24 host binding, and DoubaoWork 2.28.12 independently queried 2026-09-10.
const reset = '2026-09-12T07:23:36.982463Z';
const membership = { subscriptionBalance: { amountUsedRatio: 0, expireTime: reset } };
const goodReport = () => kimiMembershipReport(membership);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const item = (type, percent = 1, extra = {}) => ({ window_type: type, used_percent: percent, end_time: 1789570338794, ...extra });
const section = (...items) => ({ window_limit_groups: [{ feature_group: 'general', window_limits: items }] });
const doubao = (overrides = {}) => ({ code: 0, data: {
  member_info: { hasActiveSubscription: true, hasEnterpriseSubscription: false },
  window_limit_section: section(item(2), item(1, 0, { start_time: 0, end_time: 0 })), ...overrides,
} });

test('Kimi Free total preserves zero and exact server expiry without inventing Code windows', () => {
  const r = goodReport();
  assert.deepEqual(Object.keys(r.windows), ['total']);
  assert.equal(r.windows.total.usedPercent, 0);
  assert.equal(r.windows.total.resetAt, Date.parse(reset));
  assert.equal(r.windows.total.label, '总额度');
  for (const value of [null, '', false, -1, 1.1, {}, undefined]) {
    assert.equal(kimiMembershipReport({ subscriptionBalance: { amountUsedRatio: value } }), null);
  }
});

test('Kimi Work and Code ratios remain separate, disabled windows disappear', () => {
  const r = kimiMembershipReport({ ...membership,
    ratelimit5h: { enabled: true, ratio: 0.2, resetTime: reset },
    ratelimitCode5h: { enabled: true, ratio: 0.3, resetTime: reset },
    ratelimitCode7d: { enabled: false, ratio: 1 },
  });
  assert.equal(r.windows.work_five_hour.usedPercent, 20);
  assert.equal(r.windows.code_five_hour.usedPercent, 30);
  assert.equal(r.windows.code_seven_day, undefined);
  assert.equal(kimiMembershipReport({}), null);
});

test('Kimi Code resolves actual durations, decimal strings, omitted proto zero and duplicate ambiguity', () => {
  const r = kimiCodeReport({ usage: { used: '40', limit: '100', resetTime: reset }, limits: [
    { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', resetTime: reset } },
    { window: { duration: 2, timeUnit: 'TIME_UNIT_HOUR' }, detail: { used: '2', limit: '20' } },
  ] });
  assert.equal(r.windows.duration_10080.usedPercent, 40);
  assert.equal(r.windows.duration_300.usedPercent, 0);
  assert.equal(r.windows.duration_120.usedPercent, 10);
  assert.equal(kimiCodeReport({ usage: { used: null, limit: 100 } }), null);
  assert.equal(kimiCodeReport({ usage: { used: 2, limit: 0 } }), null);
  assert.equal(kimiCodeReport({ usage: { used: 2, limit: 100 }, limits: [
    { window: { duration: 1, timeUnit: 'TIME_UNIT_WEEK' }, detail: { used: 3, limit: 100 } },
  ] }), null);
});

test('Kimi desktop retries by re-reading official rotated token; only vendor origin receives it', async () => {
  let reads = 0;
  const calls = [];
  const r = await readKimiMembershipQuota({ auth: async () => ({ token: ++reads === 1 ? 'old' : 'new', origin: 'https://www.kimi.com' }),
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return options.headers.Authorization === 'Bearer old' ? json({}, 401) : json(membership);
    },
  });
  assert.equal(r.windows.total.usedPercent, 0);
  assert.equal(reads, 2);
  assert.ok(calls.every(([url, o]) => url.startsWith('https://www.kimi.com/') && o.redirect === 'error'));
  await assert.rejects(readKimiMembershipQuota({ auth: async () => ({ token: 'secret', origin: 'https://evil.invalid' }), fetchImpl: () => assert.fail('must not send') }), { code: 'EORIGIN' });
});

test('Kimi CLI discovers modern then legacy credentials and never probes another region', async () => {
  const paths = [];
  const auth = await readKimiCodeAuth({ home: '/home/test', env: { KIMI_CODE_HOME: '/custom', KIMI_CODE_BASE_URL: 'https://api.kimi.ai/coding/v1' },
    read: async (path) => { if (path.endsWith('config.toml')) return ''; paths.push(path); if (path.startsWith('/custom')) throw new Error(); return '{"access_token":"legacy"}'; },
  });
  assert.deepEqual(paths, ['/custom/credentials/kimi-code.json', '/home/test/.kimi/credentials/kimi-code.json']);
  assert.equal(auth.origin, 'https://api.kimi.ai');
  await assert.rejects(readKimiCodeAuth({ env: { KIMI_CODE_BASE_URL: 'https://proxy.invalid' }, read: () => assert.fail() }), { code: 'EORIGIN' });
  const urls = [];
  await assert.rejects(readKimiCodeQuota({ auth: async () => auth,
    fetchImpl: async (url) => { urls.push(url); return json({}, 401); },
  }), { code: 'EAUTH' });
  assert.deepEqual(urls, ['https://api.kimi.ai/coding/v1/usages', 'https://api.kimi.ai/coding/v1/usages']);
});

test('Kimi generated config binds scoped credentials to their official region', async () => {
  const paths = [];
  const config = '[providers."managed:kimi-code"]\nbase_url = "https://api.kimi.ai/coding/v1"\n[providers."managed:kimi-code".oauth]\nstorage = "file"\nkey = "oauth/kimi-code-env-abc"\noauthHost = "https://auth.kimi.ai"\n';
  const read = async (path) => { paths.push(path); return path.endsWith('config.toml') ? config : '{"access_token":"scoped"}'; };
  const auth = await readKimiCodeAuth({ home: '/x', env: {}, read });
  assert.equal(auth.origin, 'https://api.kimi.ai');
  assert.equal(paths[1], '/x/.kimi-code/credentials/kimi-code-env-abc.json');
  await assert.rejects(readKimiCodeAuth({ env: { KIMI_CODE_BASE_URL: 'https://api.kimi.com/coding/v1' }, read }), { code: 'EORIGIN' });
  await assert.rejects(readKimiCodeAuth({ env: {}, read: async (p) => p.endsWith('config.toml') ? config.replace('oauth/kimi-code-env-abc', '../escape') : assert.fail() }), { code: 'ECONFIG' });
});

test('Doubao real-response shape distinguishes not-started 5h from weekly usage', () => {
  const r = doubaoWorkQuotaReport(doubao());
  const rows = Object.values(r.windows);
  assert.equal(rows.find((w) => w.label === '5 小时').notStarted, true);
  assert.equal(rows.find((w) => w.label === '5 小时').resetAt, null);
  assert.equal(rows.find((w) => w.label === '7 天').usedPercent, 1);
  assert.equal(rows.find((w) => w.label === '7 天').resetAt, 1789570338794);
  assert.equal(doubaoWorkQuotaReport({ code: 401, data: doubao().data }), null);
  assert.equal(doubaoWorkQuotaReport(doubao({ window_limit_section: section(item(1, null)) })), null);
});

test('Doubao enterprise, quota package, exemption and <1% do not become fake percentages', () => {
  const r = doubaoWorkQuotaReport(doubao({
    member_info: { hasEnterpriseSubscription: true, hasActiveSubscription: false },
    enterprise_window_limit_section: section(item(4, 12), item(1, 83, { exemption: { active: true, end_time: 1790000000000 } })),
    quota_package_section: section(item(3, 0, { less_than_one_percent: true })),
  }));
  assert.equal(r.planType, 'enterprise');
  assert.ok(Object.keys(r.windows).every((key) => !key.startsWith('personal')));
  const unlimited = Object.values(r.windows).find((w) => w.unlimited);
  assert.equal(unlimited.usedPercent, null);
  assert.equal(unlimited.resetAt, 1790000000000);
  assert.ok(Object.values(r.windows).some((w) => w.lessThanOnePercent));
  assert.equal(doubaoWorkQuotaReport(doubao({ window_limit_section: section(item(2), item(2, 3)) })), null);
});

test('Doubao query uses the confirmed minimal request and bounded credential re-read', async () => {
  let calls = 0;
  let authReads = 0;
  const r = await readDoubaoWorkQuota({ auth: async () => { authReads++; return { session: 'sample-session', csrf: 'sample-csrf' }; },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), { product_line: 'membership' });
      assert.equal(options.headers.Cookie, 'sessionid=sample-session');
      return ++calls === 1 ? json({}, 403) : json(doubao());
    },
  });
  assert.equal(r.source, 'doubao-work');
  assert.equal(authReads, 2);
  await assert.rejects(readDoubaoWorkQuota({ auth: async () => ({ session: 's' }), fetchImpl: async () => json({ code: 1001, message: 'private information' }) }), { code: 'EREMOTE' });
});

const encrypt = (value, password, host) => {
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  const payload = Buffer.concat([host ? createHash('sha256').update(host).digest() : Buffer.alloc(0), Buffer.from(value)]);
  return Buffer.concat([Buffer.from('v10'), cipher.update(payload), cipher.final()]);
};

test('macOS storage validates version, padding and v24 exact-host hash; no hash strip for Electron', () => {
  const password = Buffer.from('test-password');
  assert.equal(decryptMacStorage(encrypt('token', password), password), 'token');
  const cookie = encrypt('session', password, '.doubao.com');
  assert.equal(decryptMacStorage(cookie, password, { cookieVersion: 24, hostKey: '.doubao.com' }), 'session');
  assert.throws(() => decryptMacStorage(cookie, password, { cookieVersion: 24, hostKey: 'doubao.com' }), { code: 'EDECRYPT' });
  assert.throws(() => decryptMacStorage(Buffer.from('v11'), password), { code: 'EDECRYPT' });
  assert.throws(() => decryptMacStorage(cookie, Buffer.from('wrong')), { code: 'EDECRYPT' });
});

test('desktop auth accepts observed encrypted container, wipes secret, rejects foreign origin', async () => {
  const secret = Buffer.from('password');
  const container = (origin) => JSON.stringify({ encryption: 'safeStorage.v1', data: encrypt(JSON.stringify({ origin, tokens: { access_token: 'token' } }), Buffer.from('password')).toString('base64') });
  const auth = await readKimiDesktopAuth({ read: async () => container('https://www.kimi.com'), password: async () => secret });
  assert.equal(auth.token, 'token');
  assert.ok(secret.every((b) => b === 0));
  await assert.rejects(readKimiDesktopAuth({ read: async () => container('https://evil.invalid'), password: async () => Buffer.from('password') }), { code: 'EORIGIN' });
  let calls = 0;
  await assert.rejects(readKimiDesktopAuth({ read: async () => { throw new Error('missing'); }, password: async () => { calls++; } }), { code: 'ENOAUTH' });
  assert.equal(calls, 0);
});

test('Doubao reads only dedicated profile and required vendor cookies', async () => {
  const password = Buffer.from('password');
  const auth = await readDoubaoWorkAuth({ profileDir: '/profiles/DoubaoWork', password: async () => Buffer.from(password),
    query: (path, sql) => {
      assert.equal(path, '/profiles/DoubaoWork/Default/Cookies');
      return sql.includes('meta') ? [{ value: '24' }] : [{ name: 'sessionid', host_key: '.doubao.com', encrypted: encrypt('s', password, '.doubao.com').toString('hex') }];
    },
  });
  assert.deepEqual(auth, { session: 's', csrf: null });
});

test('Keychain errors cannot leak stdout/stderr or cause unbounded subprocess execution', async () => {
  await assert.rejects(readDesktopStoragePassword('kimi', { platform: 'darwin', run: (cmd, args, options, callback) => {
    assert.equal(cmd, '/usr/bin/security'); assert.equal(options.timeout, 5000);
    callback(Object.assign(new Error('SECRET'), { stdout: 'SECRET', stderr: 'SECRET' }), Buffer.from('SECRET'));
  } }), (e) => e.code === 'EKEYCHAIN' && !e.message.includes('SECRET'));
  await assert.rejects(readDesktopStoragePassword('other', { platform: 'darwin', run: () => assert.fail() }), { code: 'EUNSUPPORTED' });
});

test('quota transport bounds bodies, rejects redirects/errors and redacts response content', async () => {
  await assert.rejects(quotaJson('https://www.kimi.com/', { fetchImpl: async () => json('SECRET', 500) }), (e) => e.code === 'EHTTP' && !e.message.includes('SECRET'));
  await assert.rejects(quotaJson('https://www.kimi.com/', { fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), { code: 'EPROTO' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(quotaJson('https://www.kimi.com/', { signal: controller.signal, fetchImpl: async (_, o) => { assert.ok(o.signal.aborted); throw Error('private'); } }), { code: 'EABORT' });
});

test('collector coalesces, caches errors and discards disabled/stopped in-flight results', async () => {
  let resolveRead;
  let reads = 0;
  let enabled = true;
  const records = [];
  let clock = 100;
  const c = createProviderQuotaCollector({ now: () => clock, intervalMs: 1000, enabled: () => enabled,
    read: () => { reads++; return new Promise((resolve) => { resolveRead = resolve; }); }, record: (r) => records.push(r),
  });
  const one = c.refresh(); const two = c.refresh(); assert.equal(one, two);
  await Promise.resolve(); assert.equal(reads, 1);
  enabled = false; resolveRead(goodReport()); assert.deepEqual(await one, { discarded: true }); assert.equal(records.length, 0);
  enabled = true; clock += 1001;
  const three = c.refresh(); await Promise.resolve(); c.stop(); resolveRead(goodReport()); assert.deepEqual(await three, { discarded: true });
  const e = createProviderQuotaCollector({ enabled: () => true, now: () => clock, read: async () => { throw Object.assign(new Error('SECRET'), { code: 'EAUTH' }); } });
  assert.equal((await e.refresh()).error.code, 'EAUTH');
  assert.equal((await e.refresh()).cached, true);
  assert.ok(!JSON.stringify(e.status()).includes('SECRET'));
});
