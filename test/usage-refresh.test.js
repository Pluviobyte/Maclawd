import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTailer } from '../src/runtime/tail.js';
import { createFileParser } from '../src/runtime/parsers/claude-code.js';
import { createCollector } from '../src/runtime/daemon.js';
import * as codex from '../src/runtime/parsers/codex.js';

test('Codex 尾读跨轮保留累计基线和模型，首个中途快照不算成新增', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-codex-live-'));
  const path = join(root, 'fixture.jsonl');
  writeFileSync(path, '');
  const parser = { ...codex, discover: () => {
    const s = statSync(path);
    return [{ path, size: s.size, ino: s.ino, sessionId: 'fixture' }];
  } };
  const tail = createTailer({ parsers: [parser], persist: false });
  const now = Date.now();
  const append = payload => appendFileSync(path, JSON.stringify({ type: 'event_msg', timestamp: new Date(now).toISOString(), payload }) + '\n');
  try {
    await tail.poll({ now, ignoreSettings: true });
    append({ type: 'thread_settings_applied', thread_settings: { model: 'test-model' } });
    append({ type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } });
    assert.equal((await tail.poll({ now, ignoreSettings: true })).windowTokens, 0);
    append({ type: 'token_count', info: { total_token_usage: { input_tokens: 110, output_tokens: 11, total_tokens: 121 } } });
    const result = await tail.poll({ now, ignoreSettings: true });
    assert.equal(result.windowTokens, 11);
    assert.equal(result.fresh[0].model, 'test-model');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Claude 新增 Token 按增量时间过期，窗口外重放及重启不能重新计数', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-live-delta-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = root;
  const path = join(root, 'fixture.jsonl');
  writeFileSync(path, '');
  const parser = { createFileParser, discover: () => {
    const s = statSync(path);
    return [{ path, size: s.size, ino: s.ino, sessionId: 'fixture' }];
  } };
  const options = { parsers: [parser], persist: true, windowMs: 60000 };
  let tail = createTailer(options);
  const start = Date.parse('2026-09-14T00:00:00Z');
  const poll = t => tail.poll({ now: start + t, ignoreSettings: true });
  const append = (t, output, uuid) => appendFileSync(path, JSON.stringify({
    type: 'assistant', timestamp: new Date(start + t).toISOString(), uuid, requestId: 'r',
    message: { id: 'm', model: 'test', usage: { input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: output } },
  }) + '\n');
  try {
    await poll(0);
    append(0, 1, 'a');
    assert.equal((await poll(0)).windowTokens, 1101);
    append(55000, 100, 'b');
    assert.equal((await poll(55000)).windowTokens, 1200);
    assert.equal((await poll(61000)).windowTokens, 99);
    assert.equal((await poll(120000)).windowTokens, 0);
    append(120001, 100, 'replay');
    assert.equal((await poll(120001)).windowTokens, 0);
    tail = createTailer(options);
    append(120002, 101, 'final');
    assert.equal((await poll(120002)).windowTokens, 1);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('任意来源日志变更提前刷新概览，连续活动不重置等待且扫描不并发', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-live-refresh-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = root;
  mkdirSync(join(root, 'usage'));
  writeFileSync(join(root, 'settings.json'), '{"recordUsage":true}');
  let calls = 0, active = 0, maxActive = 0;
  const collector = createCollector({
    tailer: { poll: async () => ({ fresh: [], changedFiles: 1, tokensPerMin: 0, trackedFiles: 1 }) },
    tailIntervalMs: 2, activityRefreshMs: 10, scanIntervalMs: 60000,
    scan: async () => {
      calls++; maxActive = Math.max(maxActive, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { records: [], stats: {}, sourceStatus: {}, warnings: [], elapsedMs: 5 };
    },
  });
  try {
    await collector.start({ scanNow: false });
    const deadline = Date.now() + 500;
    while (calls < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(calls >= 2, '不能等待 30 分钟或因连续变更无限推迟');
    assert.equal(maxActive, 1);
  } finally {
    collector.stop();
    while (active) await new Promise(resolve => setTimeout(resolve, 5));
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
