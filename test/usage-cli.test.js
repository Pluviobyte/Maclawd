import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRollup } from '../src/runtime/rollup.js';
import { collectionFromScan } from '../src/runtime/daemon.js';

function runStats(rollup) {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cli-'));
  const usage = join(root, 'usage');
  mkdirSync(usage, { recursive: true });
  writeFileSync(join(usage, 'rollup.json'), JSON.stringify(rollup));
  try {
    return execFileSync(process.execPath, ['bin/maclawd-usage.js', 'stats', 'today', '--cost'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, MACLAWD_DATA_DIR: root },
      encoding: 'utf8',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('collectionFromScan 把 deferred 与来源失败都保留到 rollup', () => {
  const collection = collectionFromScan({
    indexing: { deferred: 2 },
    stats: { deferred: 2 },
    sourceStatus: { codex: { complete: false, deferredFiles: 2 } },
  }, '2026-08-03T00:00:00.000Z');
  assert.equal(collection.complete, false);
  assert.equal(collection.deferredFiles, 2);
  assert.equal(collection.sources.codex.complete, false);
});

test('stats 拒绝旧 rollup，并把部分索引显示为下限', () => {
  assert.match(runStats({ v: 3, days: {}, slots: {}, sessions: {} }), /需要重新扫描/);

  const rollup = buildRollup([{
    source: 'codex', model: 'gpt-5.6-sol', project: 'Maclawd', ts: Date.now(),
    input: 100, output: 20, cacheRead: 50, write5m: 0, write1h: 0, reasoning: 0,
  }], {}, {}, {
    complete: false, scannedAt: '2026-08-03T00:00:00.000Z', deferredFiles: 2,
    sources: { codex: { complete: false, deferredFiles: 2 } },
  });
  const output = runStats(rollup);
  assert.match(output, /≥/);
  assert.match(output, /估算 .*\$/);
  assert.match(output, /采集索引尚未完成.*2 个文件/);
  assert.doesNotMatch(output, /比平时/);
});
