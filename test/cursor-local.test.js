import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cursor from '../src/runtime/parsers/cursor.js';
import { scanAll } from '../src/runtime/scan.js';
import { createTailer } from '../src/runtime/tail.js';

function stopBlock({
  ts = '2026-07-21T03:35:11.576Z', generation = 'generation-1',
  input = 106447, output = 2593, cacheRead = 52462, cacheWrite = 53981,
} = {}) {
  return [
    `[${ts}] Hook step requested: stop`,
    '════════════════════════════════════════════════════════════════',
    'stop',
    '════════════════════════════════════════════════════════════════',
    'Command: "/tmp/no-op" Stop (1ms) exit code: 0',
    '',
    'INPUT:',
    JSON.stringify({
      conversation_id: 'conversation-private',
      generation_id: generation,
      model: 'claude-opus-4-8',
      model_id: 'claude-opus-4-8',
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      hook_event_name: 'stop',
      workspace_roots: ['/private/project'],
    }, null, 2),
    '',
    'OUTPUT:',
    '(empty)',
  ].join('\n');
}

test('Cursor 本地 hook 日志提取真实 token，并按 generation 去重', () => {
  const duplicate = stopBlock();
  const records = cursor.parseCursorHookLog(`${duplicate}\n${duplicate}`);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    source: 'cursor',
    input: 4,
    output: 2593,
    cacheRead: 52462,
    write5m: 53981,
    write1h: 0,
    reasoning: 0,
    model: 'claude-opus-4-8',
    cwd: '/private/project',
    ts: Date.parse('2026-07-21T03:35:11.576Z'),
    messageId: 'cursor-local|generation-1',
    requestId: 'generation-1',
    uuid: null,
    sidechain: false,
  });
});

test('Cursor 只有云端候选需要十分钟强制刷新，本地日志按文件签名缓存', () => {
  assert.equal(cursor.cacheTtlMs({ kind: 'local-hook-log' }), null);
  assert.equal(cursor.cacheTtlMs({ kind: 'cloud-db' }), 10 * 60 * 1000);
});

test('开启 cursorCloud 后改用云端候选，不与本地日志重复累计', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-cloud-switch-'));
  const dataDir = join(root, 'data');
  const cursorRoot = join(root, 'Cursor');
  const db = join(cursorRoot, 'User', 'globalStorage', 'state.vscdb');
  mkdirSync(join(cursorRoot, 'User', 'globalStorage'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(db, 'fixture');
  writeFileSync(join(dataDir, 'settings.json'), '{"cursorCloud":true}\n');

  const previousData = process.env.MACLAWD_DATA_DIR;
  const previousRoots = process.env.MACLAWD_VSCODE_ROOTS;
  process.env.MACLAWD_DATA_DIR = dataDir;
  process.env.MACLAWD_VSCODE_ROOTS = cursorRoot;
  try {
    const candidates = cursor.discover({
      listJsonl: () => { throw new Error('云端模式不应遍历本地日志'); },
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, 'cloud-db');
    assert.equal(candidates[0].path, db);
  } finally {
    if (previousData === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previousData;
    if (previousRoots === undefined) delete process.env.MACLAWD_VSCODE_ROOTS;
    else process.env.MACLAWD_VSCODE_ROOTS = previousRoots;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor 本地日志解析不依赖 cursorCloud，也不会调用 fetch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-local-'));
  const logDir = join(root, 'logs', '20260721', 'window1', 'output');
  const log = join(logDir, 'cursor.hooks.workspaceId-test.log');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(log, stopBlock());

  const previousData = process.env.MACLAWD_DATA_DIR;
  const previousLogs = process.env.MACLAWD_CURSOR_LOG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  process.env.MACLAWD_CURSOR_LOG_DIR = join(root, 'logs');
  globalThis.fetch = () => { throw new Error('local Cursor scan must not fetch'); };

  try {
    const stat = statSync(log);
    const localParser = {
      ...cursor,
      discover: () => [{
        path: log, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: log, fallbackProject: null, kind: 'local-hook-log',
      }],
    };
    const result = await scanAll({
      parsers: [localParser], ignoreSettings: true, budgetMs: 60_000,
    });

    assert.equal(result.sourceStatus.cursor.discoveredFiles, 1);
    assert.equal(result.bySource.cursor.length, 1);
    assert.equal(result.bySource.cursor[0].input, 4);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousData === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previousData;
    if (previousLogs === undefined) delete process.env.MACLAWD_CURSOR_LOG_DIR;
    else process.env.MACLAWD_CURSOR_LOG_DIR = previousLogs;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Maclawd 自有 Cursor hook JSONL 进入统一扫描与今日汇总', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-owned-hook-'));
  const dataDir = join(root, 'data');
  const log = join(dataDir, 'usage', 'cursor-hooks', '2026-08-20.jsonl');
  mkdirSync(join(dataDir, 'usage', 'cursor-hooks'), { recursive: true });
  writeFileSync(log, `${JSON.stringify({
    source: 'cursor', generationId: 'owned-generation-1', model: 'composer-2',
    inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 300,
    ts: Date.parse('2026-08-20T08:00:00Z'),
  })}\n`);

  const previousData = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = dataDir;
  try {
    const stat = statSync(log);
    const ownedParser = {
      ...cursor,
      discover: () => [{
        path: log, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: log, fallbackProject: null, kind: 'local-hook-jsonl',
      }],
    };
    const result = await scanAll({
      parsers: [ownedParser], ignoreSettings: true, budgetMs: 60_000,
    });
    assert.equal(result.bySource.cursor.length, 1);
    assert.equal(result.bySource.cursor[0].input, 100,
      'Cursor inputTokens 含缓存，统一记录必须拆成互斥口径');
    assert.equal(result.bySource.cursor[0].cacheRead, 600);
    assert.equal(result.bySource.cursor[0].write5m, 300);
    assert.equal(result.bySource.cursor[0].output, 100);
  } finally {
    if (previousData === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previousData;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor 自有 JSONL 尾读只计算新增事件，不随文件增长重复历史', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-tail-'));
  const log = join(root, 'cursor.jsonl');
  writeFileSync(log, '');
  const parser = {
    ...cursor,
    discover: () => {
      const stat = statSync(log);
      return [{
        path: log, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: log, fallbackProject: null, kind: 'local-hook-jsonl',
      }];
    },
  };
  const tailer = createTailer({ parsers: [parser], windowMs: 60_000, persist: false });
  const now = Date.now();
  const event = (id) => `${JSON.stringify({
    source: 'cursor', generationId: id, model: 'composer-2',
    inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 300,
    ts: now,
  })}\n`;

  try {
    await tailer.poll({ now, ignoreSettings: true });
    appendFileSync(log, event('tail-1'));
    const first = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(first.windowTokens, 1100);
    appendFileSync(log, event('tail-2'));
    const second = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(second.windowTokens, 2200,
      '第二次只应增加一条，不能把第一条历史再读一次');
    appendFileSync(log, event('tail-2'));
    const retried = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(retried.windowTokens, 2200,
      '同一 generation 的 hook 重试不能再次抬高实时速率');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor 运行期间新建的每日 JSONL 从第一条进入实时速率', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-new-day-tail-'));
  const log = join(root, '2026-08-21.jsonl');
  const parser = {
    ...cursor,
    discover: () => {
      if (!existsSync(log)) return [];
      const stat = statSync(log);
      return [{
        path: log, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: log, fallbackProject: null, kind: 'local-hook-jsonl',
      }];
    },
  };
  const tailer = createTailer({ parsers: [parser], windowMs: 60_000, persist: false });
  const now = Date.now();
  try {
    await tailer.poll({ now, ignoreSettings: true });
    writeFileSync(log, `${JSON.stringify({
      source: 'cursor', generationId: 'first-of-day', model: 'composer-2',
      inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 300,
      ts: now,
    })}\n`);
    const result = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(result.windowTokens, 1100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor 尾部坏行不会触发全文件回放', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-bad-tail-'));
  const log = join(root, 'cursor.jsonl');
  writeFileSync(log, `${JSON.stringify({
    source: 'cursor', generationId: 'history', model: 'composer-2',
    inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 300,
    ts: Date.now(),
  })}\n`);
  const parser = {
    ...cursor,
    discover: () => {
      const stat = statSync(log);
      return [{
        path: log, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: log, fallbackProject: null, kind: 'local-hook-jsonl',
      }];
    },
  };
  const tailer = createTailer({ parsers: [parser], windowMs: 60_000, persist: false });
  try {
    await tailer.poll({ now: Date.now(), ignoreSettings: true });
    appendFileSync(log, '{broken}\n');
    const result = await tailer.poll({ now: Date.now(), ignoreSettings: true });
    assert.equal(result.windowTokens, 0, '坏行应被跳过，不能把首轮历史重新计入');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor 首次 discover 失败后恢复时只建立基线，不回放已有历史', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-discover-recovery-'));
  const log = join(root, 'cursor.jsonl');
  const now = Date.now();
  const event = (id) => `${JSON.stringify({
    source: 'cursor', generationId: id, model: 'composer-2',
    inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 300,
    ts: now,
  })}\n`;
  writeFileSync(log, event('existing-before-recovery'));
  let attempts = 0;
  const parser = {
    ...cursor,
    discover: () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary discovery failure');
      const stat = statSync(log);
      return [{
        path: log, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: log, fallbackProject: null, kind: 'local-hook-jsonl',
      }];
    },
  };
  const tailer = createTailer({ parsers: [parser], windowMs: 60_000, persist: false });
  try {
    await tailer.poll({ now, ignoreSettings: true });
    const recovered = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(recovered.windowTokens, 0, '恢复轮只建立现有文件基线');
    appendFileSync(log, event('after-recovery'));
    const appended = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(appended.windowTokens, 1100, '恢复后的新增事件照常进入实时速率');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
