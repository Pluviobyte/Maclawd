import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWorkBuddyQuotaCollector, findWorkBuddyCredential, readWorkBuddyQuota,
  workBuddyAuthDirectories, workBuddyQuotaReport,
} from '../src/runtime/workbuddy-quota.js';

test('WorkBuddy 真实资源响应按基础包与额外包分别保留精确积分', () => {
  const report = workBuddyQuotaReport({
    code: 0,
    data: { Response: { Data: { Accounts: [
      {
        CapacityType: 4,
        PackageName: '基础体验包',
        CycleCapacityUsedPrecise: '253.61999997',
        CycleCapacitySizePrecise: '500',
        CycleCapacityRemainPrecise: '246.38000003',
        CycleEndTime: '2026-08-31 23:59:59',
        DeductionEndTime: 2_044_685_260_000,
        Status: 0,
      },
      {
        CapacityType: 1,
        AccountId: 'gift-account-7',
        PackageName: '活动赠送包',
        CycleCapacityUsedPrecise: '99',
        CycleCapacitySizePrecise: '999',
        CycleCapacityRemainPrecise: '900',
        CapacityUsedPrecise: '10.5',
        CapacitySizePrecise: '100',
        CapacityRemainPrecise: '89.5',
        ExpiredTime: '2026-09-15 23:59:59',
        Status: 0,
      },
    ] } } },
  }, { timeZoneOffsetMinutes: 480 });

  assert.equal(report.source, 'workbuddy');
  assert.equal(report.sourceLabel, 'WorkBuddy');
  assert.equal(report.completeSnapshot, true);
  const baseKey = Object.keys(report.windows).find((key) => key.startsWith('base_'));
  const bonusKey = Object.keys(report.windows).find((key) => key.startsWith('bonus_'));
  assert.ok(baseKey);
  assert.ok(bonusKey);
  assert.deepEqual(report.windows[baseKey], {
    label: '基础体验包',
    kind: 'base',
    used: 253.61999997,
    limit: 500,
    remaining: 246.38000003,
    usedPercent: 50.723999994,
    resetAt: Date.parse('2026-08-31T16:00:00.000Z'),
  });
  assert.equal(report.windows[bonusKey].label, '活动赠送包');
  assert.equal(report.windows[bonusKey].kind, 'bonus');
  assert.equal(report.windows[bonusKey].used, 10.5);
  assert.equal(report.windows[bonusKey].limit, 100);
  assert.equal(report.windows[bonusKey].remaining, 89.5);
  assert.equal(report.windows[bonusKey].usedPercent, 10.5);
  assert.equal(report.windows[bonusKey].resetAt, Date.parse('2026-09-15T16:00:00.000Z'));
});

test('WorkBuddy 资源顺序改变时积分桶身份保持稳定', () => {
  const resource = (accountId, capacityType, packageName) => ({
    AccountId: accountId,
    CapacityType: capacityType,
    PackageName: packageName,
    CycleCapacityUsedPrecise: '10',
    CycleCapacitySizePrecise: '100',
    CycleCapacityRemainPrecise: '90',
    CapacityUsedPrecise: '10',
    CapacitySizePrecise: '100',
    CapacityRemainPrecise: '90',
    CycleEndTime: '2026-08-31 23:59:59',
    ExpiredTime: '2026-09-15 23:59:59',
    Status: 0,
  });
  const report = (accounts) => workBuddyQuotaReport({
    data: { Response: { Data: { Accounts: accounts } } },
  });
  const base = resource('base-account-2', 4, '基础体验包');
  const gift = resource('gift-account-7', 1, '活动赠送包');
  const gift2 = resource('gift-account-8', 1, '加量包');
  assert.deepEqual(
    Object.keys(report([base, gift, gift2]).windows).sort(),
    Object.keys(report([gift2, gift, base]).windows).sort(),
  );
});

test('从 WorkBuddy 本地认证文件发现账号凭据并优先桌面版身份', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-workbuddy-auth-'));
  const authDir = join(root, 'auth');
  mkdirSync(authDir);
  writeFileSync(join(authDir, 'Tencent-Cloud.coding-copilot.info'), JSON.stringify({
    account: { uid: 'codebuddy-user' },
    auth: { accessToken: 'codebuddy-token', domain: 'www.codebuddy.cn' },
  }));
  writeFileSync(join(authDir, 'workbuddy-desktop.info'), `\uFEFF${JSON.stringify({
    account: { uid: 'workbuddy-user', enterpriseId: 'enterprise-1' },
    auth: { accessToken: 'workbuddy-token', domain: 'copilot.tencent.com' },
  })}`);

  try {
    assert.deepEqual(findWorkBuddyCredential({ authDirs: [authDir] }), {
      accessToken: 'workbuddy-token',
      uid: 'workbuddy-user',
      enterpriseId: 'enterprise-1',
      domain: 'copilot.tencent.com',
      sourcePath: join(authDir, 'workbuddy-desktop.info'),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS 同时兼容 CodeBuddyExtension 与 WorkBuddyExtension 认证目录', () => {
  assert.deepEqual(workBuddyAuthDirectories({ home: '/Users/alice', platform: 'darwin' }), [
    '/Users/alice/Library/Application Support/CodeBuddyExtension/Data/Public/auth',
    '/Users/alice/Library/Application Support/WorkBuddyExtension/Data/Public/auth',
  ]);
});

test('存在 logged-out 标记时不复用已经登出的 WorkBuddy Token', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-workbuddy-logout-'));
  const authFile = join(root, 'workbuddy-desktop.info');
  writeFileSync(authFile, JSON.stringify({ auth: { accessToken: 'stale-token' } }));
  writeFileSync(`${authFile}.logged-out`, '');
  try {
    assert.equal(findWorkBuddyCredential({ authDirs: [root] }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('使用本机身份请求计费接口并返回可直接记录的额度报告', async () => {
  const calls = [];
  const responseBody = {
    code: 0,
    data: { Response: { Data: { Accounts: [{
      CapacityType: 4,
      CycleCapacityUsed: 25,
      CycleCapacitySize: 100,
      CycleCapacityRemain: 75,
      CycleEndTime: '2026-08-31 23:59:59',
      Status: 0,
    }] } } },
  };
  const report = await readWorkBuddyQuota({
    credential: {
      accessToken: 'secret-token',
      uid: 'user-1',
      domain: 'www.codebuddy.cn',
    },
    now: new Date('2026-08-05T00:00:00Z'),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify(responseBody) };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.codebuddy.cn/v2/billing/meter/get-user-resource');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].options.headers['X-User-Id'], 'user-1');
  assert.equal(calls[0].options.headers['X-Enterprise-Id'], undefined);
  assert.equal(calls[0].options.headers['X-Tenant-Id'], undefined);
  assert.equal(calls[0].options.headers['X-Domain'], 'www.codebuddy.cn');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [0, 3],
    PackageEndTimeRangeBegin: '2026-08-05 08:00:00',
    PackageEndTimeRangeEnd: '2127-07-12 08:00:00',
  });
  assert.equal(Object.values(report.windows)[0].usedPercent, 25);
});

test('WorkBuddy 额度采集器合并刷新、缓存结果并在开关关闭后停止读取', async () => {
  let enabled = true;
  let reads = 0;
  const recorded = [];
  const report = {
    source: 'workbuddy', sourceLabel: 'WorkBuddy', completeSnapshot: true,
    windows: { base_1: { label: '基础包', usedPercent: 20, resetAt: 1_800_000_000_000 } },
  };
  const collector = createWorkBuddyQuotaCollector({
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

test('WorkBuddy 计费请求有超时边界且错误信息不泄露 Token', async () => {
  const secret = 'never-print-this-token';
  await assert.rejects(
    readWorkBuddyQuota({
      credential: { accessToken: secret, uid: 'user-1', domain: 'www.codebuddy.cn' },
      timeoutMs: 5,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    }),
    (error) => error.code === 'ETIMEDOUT' && !error.message.includes(secret),
  );
});

test('鉴权失败不会把同一个 WorkBuddy Token 继续发送到其它域名', async () => {
  const calls = [];
  await assert.rejects(readWorkBuddyQuota({
    credential: { accessToken: 'domain-bound-token', uid: 'user-1', domain: 'www.codebuddy.cn' },
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: false, status: 401, text: async () => '' };
    },
  }), (error) => error.code === 'EAUTH');
  assert.deepEqual(calls, ['https://www.codebuddy.cn/v2/billing/meter/get-user-resource']);
});

test('企业 WorkBuddy 账号使用企业计费接口并映射总额、已用和周期刷新', async () => {
  const calls = [];
  const report = await readWorkBuddyQuota({
    credential: {
      accessToken: 'enterprise-token', uid: 'user-1',
      enterpriseId: 'enterprise-1', domain: 'copilot.tencent.com',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          code: 0,
          data: { data: { limitNum: '10000', credit: '1250.5', cycleResetTime: '2026-09-01 00:00:00' } },
        }),
      };
    },
  });

  assert.equal(calls[0].url,
    'https://copilot.tencent.com/billing/meter/get-enterprise-user-usage');
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  assert.equal(calls[0].options.headers['X-Enterprise-Id'], 'enterprise-1');
  assert.equal(calls[0].options.headers['X-Tenant-Id'], 'enterprise-1');
  assert.deepEqual(report.windows.base_1, {
    label: '企业额度', kind: 'base', used: 1250.5, limit: 10000,
    remaining: 8749.5, usedPercent: 12.504999999999999,
    resetAt: Date.parse('2026-08-31T16:00:01.000Z'),
  });
});
