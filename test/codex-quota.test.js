import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

const data = mkdtempSync(join(tmpdir(), 'maclawd-codex-quota-'));
process.env.MACLAWD_DATA_DIR = data;

const {
  codexRateLimitReports, createCodexQuotaCollector, readCodexRateLimits,
} = await import('../src/runtime/codex-quota.js');
const { clearQuota, readQuota, recordQuota } = await import('../src/runtime/account-quota.js');

const NOW = 1_785_800_000_000;

test.after(() => rmSync(data, { recursive: true, force: true }));
test.beforeEach(() => clearQuota());

test('Codex 官方额度响应只读取订阅 codex 桶并与 Claude 独立展示', () => {
  const result = {
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1_786_000_000 },
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex', planType: 'pro',
        primary: { usedPercent: 51, windowDurationMins: 10_080, resetsAt: 1_817_738_663 },
        secondary: null,
      },
      codex_bengalfox: {
        limitId: 'codex_bengalfox', limitName: 'GPT-5.3-Codex-Spark', planType: 'pro',
        primary: { usedPercent: 7, windowDurationMins: 10_080, resetsAt: 1_786_422_860 },
        secondary: null,
      },
    },
  };

  const reports = codexRateLimitReports(result);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], {
    source: 'codex',
    sourceLabel: 'Codex',
    planType: 'pro',
    completeSnapshot: true,
    windows: {
      seven_day: {
        label: '本周', durationMinutes: 10_080,
        usedPercent: 51, resetAt: 1_817_738_663_000,
      },
    },
  });
  recordQuota({
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 20, resetAt: NOW + 3_600_000 } },
  }, { now: NOW });
  for (const report of reports) recordQuota(report, { now: NOW });

  const snapshot = readQuota({ now: NOW });
  assert.deepEqual(snapshot.sources.map((source) => source.label), [
    'Claude Code', 'Codex',
  ]);
  const codex = snapshot.sources.find((source) => source.id === 'codex');
  assert.equal(codex.windows[0].label, '本周');
  assert.equal(codex.windows[0].usedPercent, 51,
    '必须优先 rateLimitsByLimitId.codex，不能读兼容字段里的 99%');
});

test('额度 map 缺少 codex 时回退兼容 rateLimits 字段', () => {
  const [report] = codexRateLimitReports({
    rateLimits: {
      limitId: 'codex', planType: 'plus',
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_786_000_000 },
    },
    rateLimitsByLimitId: {
      codex_bengalfox: {
        limitId: 'codex_bengalfox',
        primary: { usedPercent: 7, windowDurationMins: 10_080, resetsAt: 1_786_422_860 },
      },
    },
  });

  assert.equal(report.source, 'codex');
  assert.equal(report.planType, 'plus');
  assert.equal(report.windows.five_hour.usedPercent, 42);
});

test('Codex 未知时长窗口按真实时长命名，不丢弃也不猜成 5 小时', () => {
  const [report] = codexRateLimitReports({
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 12, windowDurationMins: 90, resetsAt: 1_786_000_000 },
      secondary: { usedPercent: 34, windowDurationMins: null, resetsAt: null },
    },
  });

  assert.deepEqual(Object.keys(report.windows), ['duration_90', 'codex_secondary']);
  assert.equal(report.windows.duration_90.label, '90 分钟');
  assert.equal(report.windows.codex_secondary.label, '额度窗口');

  recordQuota(report, { now: NOW });
  const windows = readQuota({ now: NOW }).sources[0].windows;
  assert.deepEqual(windows.map((window) => window.label), ['90 分钟', '额度窗口']);
});

test('Codex 完整快照中消失的窗口不会残留旧值', () => {
  const [first] = codexRateLimitReports({
    rateLimits: {
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_786_000_000 },
      secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 1_786_500_000 },
    },
  });
  const [second] = codexRateLimitReports({
    rateLimits: {
      primary: null,
      secondary: { usedPercent: 21, windowDurationMins: 10_080, resetsAt: 1_786_500_000 },
    },
  });

  recordQuota(first, { now: NOW });
  recordQuota(second, { now: NOW + 1_000 });
  assert.deepEqual(readQuota({ now: NOW + 1_000 }).sources[0].windows.map(({ id }) => id), [
    'seven_day',
  ]);
});

test('Codex 返回有效空快照时清除全部旧窗口', () => {
  const [first] = codexRateLimitReports({
    rateLimits: {
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_786_000_000 },
    },
  });
  const [empty] = codexRateLimitReports({
    rateLimits: { limitId: 'codex', primary: null, secondary: null },
  });

  assert.equal(empty.completeSnapshot, true);
  assert.deepEqual(empty.windows, {});
  recordQuota(first, { now: NOW });
  recordQuota(empty, { now: NOW + 1_000 });
  assert.equal(readQuota({ now: NOW + 1_000 }).empty, true);
});

test('通过短命 Codex app-server 完成官方握手并读取额度', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.killed = false;
  child.exited = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => { child.exited = true; child.emit('exit', 0); });
  };
  const requests = [];
  child.stdin = {
    write(line) {
      const request = JSON.parse(line);
      requests.push(request);
      if (request.id === 1) {
        queueMicrotask(() => child.stdout.emit('data', '{"id":1,"result":{"userAgent":"codex"}}\n'));
      }
      if (request.id === 2) {
        queueMicrotask(() => child.stdout.emit('data', '{"id":2,"result":{"rateLimits":{"limitId":"codex","primary":{"usedPercent":51,"windowDurationMins":10080,"resetsAt":1786202663}}}}\n'));
      }
      return true;
    },
    end() {},
  };
  let invocation;
  const result = await readCodexRateLimits({
    command: '/fake/codex',
    timeoutMs: 100,
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return child;
    },
  });

  assert.equal(invocation.command, '/fake/codex');
  assert.deepEqual(invocation.args, ['app-server', '--stdio']);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(requests.map(({ method }) => method), [
    'initialize', 'initialized', 'account/rateLimits/read',
  ]);
  assert.equal(result.rateLimits.primary.usedPercent, 51);
  assert.equal(child.killed, true);
  assert.equal(child.exited, true, '读取 Promise 完成时短命子进程必须已经退出');
});

test('Codex app-server stdin EPIPE 被转成读取失败，不会成为未处理异常', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.write = () => {
    queueMicrotask(() => {
      const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
      child.stdin.emit('error', error);
    });
    return false;
  };
  child.stdin.end = () => {};
  child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); };

  await assert.rejects(readCodexRateLimits({
    command: '/fake/codex', timeoutMs: 100, spawnImpl: () => child,
  }), { code: 'EPIPE' });
});

test('AbortSignal 会立即终止正在运行的 Codex app-server', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  child.stdin.write = () => true;
  child.stdin.end = () => {};
  child.killedWith = null;
  child.kill = (signal) => {
    child.killedWith = signal;
    queueMicrotask(() => child.emit('exit', 0));
  };
  const controller = new AbortController();
  const reading = readCodexRateLimits({
    command: '/fake/codex', timeoutMs: 10_000, signal: controller.signal,
    spawnImpl: () => child,
  });

  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(child.killedWith, 'SIGTERM');
});

test('runtime 同时刷新只启动一次 Codex 读取，成功后写入统一快照', async () => {
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const collector = createCodexQuotaCollector({
    enabled: () => true,
    command: '/fake/codex',
    read: async () => {
      reads++;
      await gate;
      return {
        rateLimits: {
          limitId: 'codex', planType: 'pro',
          primary: { usedPercent: 51, windowDurationMins: 10_080, resetsAt: 1_817_738_663 },
        },
      };
    },
  });

  const first = collector.refresh({ force: true });
  const second = collector.refresh({ force: true });
  release();
  await Promise.all([first, second]);

  assert.equal(reads, 1, '面板与定时器不得同时起两个 app-server');
  assert.equal(readQuota({ now: NOW }).sources[0].id, 'codex');
  assert.equal(collector.status().lastSuccessAt > 0, true);
  collector.stop();
});

test('关闭采集器会丢弃仍在进行中的读取结果', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let isEnabled = true;
  const collector = createCodexQuotaCollector({
    enabled: () => isEnabled,
    command: '/fake/codex',
    read: async () => {
      await gate;
      return {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 51, windowDurationMins: 10_080, resetsAt: 1_817_738_663 },
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

  assert.equal(readQuota({ now: NOW }).empty, true);
  assert.equal(collector.status().lastSuccessAt, 0);
});

test('十分钟内命中缓存不重复读取，刷新失败保留上一份成功额度', async () => {
  let reads = 0;
  let shouldFail = false;
  const collector = createCodexQuotaCollector({
    intervalMs: 10 * 60_000,
    enabled: () => true,
    command: '/fake/codex',
    read: async () => {
      reads++;
      if (shouldFail) throw Object.assign(new Error('temporary failure'), { code: 'ETEMP' });
      return {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 51, windowDurationMins: 10_080, resetsAt: 1_817_738_663 },
        },
      };
    },
  });

  await collector.refresh({ force: true });
  assert.equal((await collector.refresh()).cached, true);
  assert.equal(reads, 1);

  shouldFail = true;
  const failed = await collector.refresh({ force: true });
  assert.equal(failed.error.code, 'ETEMP');
  assert.equal(readQuota({ now: NOW }).sources[0].windows[0].usedPercent, 51);
});
