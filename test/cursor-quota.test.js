import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'maclawd-cursor-quota-'));
process.env.MACLAWD_DATA_DIR = data;

const {
  parseCursorToken, cursorUsageReport, readCursorUsage, createCursorQuotaCollector,
} = await import('../src/runtime/cursor-quota.js');
const { cursorAuthAttempts } = await import('../src/runtime/cursor-auth.js');
const { clearQuota, readQuota, recordQuota } = await import('../src/runtime/account-quota.js');

const NOW = 1_785_800_000_000;

test.after(() => rmSync(data, { recursive: true, force: true }));
test.beforeEach(() => clearQuota());

test('从 sqlite3 输出解析 Cursor access token', () => {
  assert.equal(parseCursorToken('abc123token\n'), 'abc123token');
  assert.equal(parseCursorToken('  token-with-spaces  \n'), 'token-with-spaces');
  assert.equal(parseCursorToken(''), null);
  assert.equal(parseCursorToken('\n'), null);
  assert.equal(parseCursorToken(null), null);
  assert.equal(parseCursorToken(undefined), null);
});

test('Cursor usage API 响应按 premium 模型聚合为月度请求窗口', () => {
  const report = cursorUsageReport({
    'gpt-4': { numRequests: 100, numRequestsTotal: 500 },
    'claude-3.5-sonnet': { numRequests: 200, numRequestsTotal: 500 },
    'o1-mini': { numRequests: 50, numRequestsTotal: 500 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(report.source, 'cursor');
  assert.equal(report.sourceLabel, 'Cursor');
  assert.equal(report.completeSnapshot, true);
  assert.equal(report.windows.monthly_requests.used, 350);
  assert.equal(report.windows.monthly_requests.limit, 1500);
  assert.equal(report.windows.monthly_requests.remaining, 1150);
  assert.ok(Math.abs(report.windows.monthly_requests.usedPercent - (350 / 1500 * 100)) < 0.001);
  assert.equal(report.windows.monthly_requests.label, '本月请求');
  assert.equal(report.windows.monthly_requests.resetAt, new Date('2026-09-01T00:00:00.000Z').getTime());
});

test('Cursor usage 中没有限额的模型不计入聚合', () => {
  const report = cursorUsageReport({
    'gpt-4': { numRequests: 100, numRequestsTotal: 500 },
    'cursor-small': { numRequests: 999, numRequestsTotal: 0 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(report.windows.monthly_requests.used, 100);
  assert.equal(report.windows.monthly_requests.limit, 500);
  assert.equal(report.windows.monthly_requests.usedPercent, 20);
});

test('Cursor usage 全部模型限额为零时返回 null', () => {
  assert.equal(cursorUsageReport({
    'cursor-small': { numRequests: 100, numRequestsTotal: 0 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  }), null);
});

test('Cursor usage 空响应返回 null', () => {
  assert.equal(cursorUsageReport(null), null);
  assert.equal(cursorUsageReport({}), null);
  assert.equal(cursorUsageReport({ startOfMonth: '2026-08-01T00:00:00.000Z' }), null);
});

test('Cursor 额度报告写入统一快照后能被正确读取', () => {
  const report = cursorUsageReport({
    'gpt-4': { numRequests: 100, numRequestsTotal: 500 },
    'claude-3.5-sonnet': { numRequests: 200, numRequestsTotal: 500 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  });
  recordQuota(report, { now: NOW });

  const snapshot = readQuota({ now: NOW });
  assert.equal(snapshot.empty, false);
  const cursor = snapshot.sources.find((s) => s.id === 'cursor');
  assert.ok(cursor);
  assert.equal(cursor.label, 'Cursor');
  assert.equal(cursor.windows.length, 1);
  assert.equal(cursor.windows[0].id, 'monthly_requests');
  assert.equal(cursor.windows[0].label, '本月请求');
  assert.equal(cursor.windows[0].used, 300);
  assert.equal(cursor.windows[0].limit, 1000);
});

test('缺少 startOfMonth 时 resetAt 为 null', () => {
  const report = cursorUsageReport({
    'gpt-4': { numRequests: 10, numRequestsTotal: 500 },
  });
  assert.equal(report.windows.monthly_requests.resetAt, null);
});

test('readCursorUsage 在 Cursor 未安装时优雅失败', async () => {
  await assert.rejects(readCursorUsage({
    tokenReader: async () => {
      const error = new Error('未找到 Cursor 数据库');
      error.code = 'ENOENT';
      throw error;
    },
  }), { code: 'ENOENT' });
});

test('readCursorUsage 请求 usage API 并返回额度报告', async () => {
  const calls = [];
  const responseBody = {
    'gpt-4': { numRequests: 50, numRequestsTotal: 500 },
    'claude-3.5-sonnet': { numRequests: 150, numRequestsTotal: 500 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  };

  const report = await readCursorUsage({
    tokenReader: async () => 'test-token-abc',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify(responseBody) };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cursor.com/api/usage');
  assert.equal(calls[0].options.method, 'GET');
  assert.ok(calls[0].options.headers.Cookie.includes('WorkosCursorSessionToken='));
  assert.ok(calls[0].options.headers.Cookie.includes('test-token-abc'));
  assert.equal(report.source, 'cursor');
  assert.equal(report.windows.monthly_requests.used, 200);
});

test('Cursor 认证优先使用 JWT sub 组成的 dashboard Cookie', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user-123' })).toString('base64url');
  const token = `header.${payload}.signature`;
  const attempts = cursorAuthAttempts(token);

  assert.equal(
    attempts[0].Cookie,
    `WorkosCursorSessionToken=auth0|user-123%3A%3A${token}`,
  );
  assert.equal(
    attempts[1].Cookie,
    `WorkosCursorSessionToken=user-123%3A%3A${token}`,
  );
  assert.equal(attempts.at(-1).Authorization, `Bearer ${token}`);
});

test('readCursorUsage 在完整 sub Cookie 被拒绝时会回退 user id Cookie', async () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user-123' })).toString('base64url');
  const token = `header.${payload}.signature`;
  const cookies = [];
  const report = await readCursorUsage({
    tokenReader: async () => token,
    fetchImpl: async (_url, options) => {
      cookies.push(options.headers.Cookie ?? null);
      if (cookies.length === 1) return { ok: false, status: 401, text: async () => '' };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          'gpt-5': { numRequests: 1, numRequestsTotal: 500 },
          startOfMonth: '2026-08-01T00:00:00.000Z',
        }),
      };
    },
  });

  assert.equal(cookies.length, 2);
  assert.equal(report.windows.monthly_requests.used, 1);
});

test('readCursorUsage 对 401/403 报鉴权失败', async () => {
  await assert.rejects(readCursorUsage({
    tokenReader: async () => 'stale-token',
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }),
  }), { code: 'EAUTH' });
});

test('Cursor 额度采集器合并刷新、缓存结果并在开关关闭后停止读取', async () => {
  let enabled = true;
  let reads = 0;
  const recorded = [];
  const report = {
    source: 'cursor', sourceLabel: 'Cursor', completeSnapshot: true,
    windows: {
      monthly_requests: {
        label: '本月请求', usedPercent: 20, used: 100, limit: 500,
        remaining: 400, resetAt: 1_800_000_000_000,
      },
    },
  };
  const collector = createCursorQuotaCollector({
    intervalMs: 600_000,
    enabled: () => enabled,
    read: async () => { reads++; return report; },
    record: (value) => recorded.push(value),
  });

  const [first, joined] = await Promise.all([
    collector.refresh({ force: true }),
    collector.refresh({ force: true }),
  ]);
  assert.equal(first.reports, 1);
  assert.equal(joined.reports, 1);
  assert.equal(reads, 1);
  assert.deepEqual(recorded, [report]);
  assert.equal((await collector.refresh()).cached, true);

  enabled = false;
  assert.equal((await collector.refresh({ force: true })).disabled, true);
  assert.equal(reads, 1);
});

test('关闭 Cursor 采集器会丢弃在途结果', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let isEnabled = true;
  const collector = createCursorQuotaCollector({
    enabled: () => isEnabled,
    read: async () => {
      await gate;
      return {
        source: 'cursor', sourceLabel: 'Cursor', completeSnapshot: true,
        windows: {
          monthly_requests: {
            label: '本月请求', usedPercent: 20, used: 100, limit: 500,
            remaining: 400, resetAt: 1_800_000_000_000,
          },
        },
      };
    },
  });

  collector.start();
  isEnabled = false;
  collector.stop();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(readQuota({ now: NOW }).sources.find((s) => s.id === 'cursor'), undefined);
  assert.equal(collector.status().lastSuccessAt, 0);
});

test('Cursor 百分比计算跨多个模型聚合正确', () => {
  const report = cursorUsageReport({
    'gpt-4': { numRequests: 400, numRequestsTotal: 500 },
    'gpt-4o': { numRequests: 300, numRequestsTotal: 500 },
    'claude-3.5-sonnet': { numRequests: 450, numRequestsTotal: 500 },
    'o1-mini': { numRequests: 100, numRequestsTotal: 500 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(report.windows.monthly_requests.used, 1250);
  assert.equal(report.windows.monthly_requests.limit, 2000);
  assert.equal(report.windows.monthly_requests.remaining, 750);
  assert.equal(report.windows.monthly_requests.usedPercent, 62.5);
});

test('Cursor 百分比不超过 100', () => {
  const report = cursorUsageReport({
    'gpt-4': { numRequests: 600, numRequestsTotal: 500 },
    startOfMonth: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(report.windows.monthly_requests.usedPercent, 100);
});
