import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maclawd-catchup-'));
const data = join(root, 'data');
mkdirSync(data, { recursive: true });
process.env.MACLAWD_DATA_DIR = data;
process.env.MACLAWD_CLAUDE_DIRS = join(root, 'empty-claude');
process.env.MACLAWD_CODEX_HOME = join(root, 'empty-codex');
process.env.MACLAWD_WORKBUDDY_DIR = join(root, 'empty-workbuddy');
writeFileSync(join(data, 'settings.json'), '{"recordUsage":true}\n');

const { createCollector } = await import('../src/runtime/daemon.js');

test('冷启动有待处理文件时短间隔续扫，完成后恢复普通周期', async () => {
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const scan = async () => {
    calls++;
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 4));
    concurrent--;
    const complete = calls >= 3;
    return {
      records: [], sessionsBySource: {}, projectPaths: {}, warnings: [], elapsedMs: 4,
      stats: { reused: 0, appended: 0, full: 1, deferred: complete ? 0 : 10, bytesRead: 1 },
      sourceStatus: {
        codex: {
          discoveredFiles: 30, indexedFiles: complete ? 30 : calls * 10,
          deferredFiles: complete ? 0 : 30 - calls * 10,
          failedFiles: 0, complete,
        },
      },
      indexing: complete ? null : { deferred: 30 - calls * 10 },
    };
  };

  const collector = createCollector({
    scan,
    catchUpIntervalMs: 5,
    scanIntervalMs: 60_000,
    tailIntervalMs: 60_000,
  });
  try {
    await collector.start();
    const deadline = Date.now() + 300;
    while (calls < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(calls, 3, 'backlog 应该连续处理完，不该等 30 分钟');
    assert.equal(maxConcurrent, 1, '续扫不能和上一轮重叠');

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 3, '完成后应该恢复普通周期，不再高频扫描');
  } finally {
    collector.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('deferred 单独表示积压时也会续扫', async () => {
  let calls = 0;
  const scan = async () => {
    calls++;
    const complete = calls >= 2;
    return {
      records: [], sessionsBySource: {}, projectPaths: {}, warnings: [], elapsedMs: 1,
      stats: { reused: 0, appended: 0, full: 1, deferred: complete ? 0 : 1, bytesRead: 1 },
      sourceStatus: {},
      indexing: null,
    };
  };
  const collector = createCollector({
    scan,
    catchUpIntervalMs: 5,
    scanIntervalMs: 60_000,
    tailIntervalMs: 60_000,
  });
  try {
    await collector.start();
    const deadline = Date.now() + 100;
    while (calls < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(calls, 2);
  } finally {
    collector.stop();
  }
});

test('首轮扫描中停止再重启，不泄漏尾读定时器', async () => {
  let releaseScan;
  const scanBlocked = new Promise((resolve) => { releaseScan = resolve; });
  let intervalCreations = 0;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    intervalCreations++;
    return originalSetInterval(...args);
  };
  const scan = async () => {
    await scanBlocked;
    return {
      records: [], sessionsBySource: {}, projectPaths: {}, warnings: [], elapsedMs: 1,
      stats: { reused: 0, appended: 0, full: 0, deferred: 0, bytesRead: 0 },
      sourceStatus: {}, indexing: null,
    };
  };
  const collector = createCollector({
    scan,
    catchUpIntervalMs: 5,
    scanIntervalMs: 60_000,
    tailIntervalMs: 60_000,
  });
  try {
    const firstStart = collector.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    collector.stop();
    releaseScan();
    await firstStart;
    assert.equal(intervalCreations, 0, '已停止的 start 不得在扫描后续创建定时器');

    await collector.start({ scanNow: false });
    assert.equal(intervalCreations, 1, '重启后只应有一个尾读定时器');
  } finally {
    collector.stop();
    globalThis.setInterval = originalSetInterval;
  }
});
