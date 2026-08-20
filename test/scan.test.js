import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, appendFileSync, writeFileSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTurnTracker, summarizeSessions } from '../src/runtime/sessions.js';
import { intensityFromRate } from '../src/runtime/tail.js';

/**
 * 扫描器的增量尾读是整个性能预算的支点（Codex 单文件可达 290MB），
 * 所以用真实临时文件端到端验证三级读取策略，而不是打桩。
 */

function assistantLine(ts, { input = 100, output = 50, cacheRead = 0, id, uuid }) {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: '/Users/rain/Desktop/Maclawd',
    uuid,
    requestId: `req-${uuid}`,
    message: {
      id,
      model: 'claude-opus-5',
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
      },
    },
  })}\n`;
}

function userLine(ts, uuid) {
  return `${JSON.stringify({ type: 'user', timestamp: ts, uuid, cwd: '/Users/rain/Desktop/Maclawd' })}\n`;
}

async function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-scan-'));
  const claudeRoot = join(root, 'claude');
  const projectDir = join(claudeRoot, 'projects', '-Users-rain-Desktop-Maclawd');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'session-a.jsonl');

  const prevData = process.env.MACLAWD_DATA_DIR;
  const prevDirs = process.env.MACLAWD_CLAUDE_DIRS;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  process.env.MACLAWD_CLAUDE_DIRS = claudeRoot;

  // 环境变量在模块加载后才设置，所以要在设置之后再动态 import。
  const claudeCode = await import('../src/runtime/parsers/claude-code.js');
  const { scanAll } = await import('../src/runtime/scan.js');
  const scan = () => scanAll({ parsers: [claudeCode], budgetMs: 60_000 });

  try {
    await run({ file, scan });
  } finally {
    if (prevData === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = prevData;
    if (prevDirs === undefined) delete process.env.MACLAWD_CLAUDE_DIRS;
    else process.env.MACLAWD_CLAUDE_DIRS = prevDirs;
    rmSync(root, { recursive: true, force: true });
  }
}

test('第 3 级：首次全量读取，项目名从 cwd 推导', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(file, assistantLine('2026-07-30T10:00:00Z', { id: 'm1', uuid: 'u1' }));
    const result = await scan();
    assert.equal(result.stats.full, 1);
    assert.equal(result.bySource['claude-code'].length, 1);
    assert.equal(result.bySource['claude-code'][0].project, 'Maclawd');
  });
});

test('第 1 级：签名未变时零磁盘读', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(file, assistantLine('2026-07-30T10:00:00Z', { id: 'm1', uuid: 'u1' }));
    await scan();
    const second = await scan();
    assert.equal(second.stats.reused, 1);
    assert.equal(second.stats.full, 0);
    assert.equal(second.stats.appended, 0);
    assert.equal(second.stats.bytesRead, 0, '复用路径不应产生任何读取');
    assert.equal(second.bySource['claude-code'].length, 1);
  });
});

test('第 2 级：纯追加只读新增字节', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(file, assistantLine('2026-07-30T10:00:00Z', { id: 'm1', uuid: 'u1' }));
    const first = await scan();
    const firstBytes = first.stats.bytesRead;

    const appendedLine = assistantLine('2026-07-30T10:05:00Z', { id: 'm2', uuid: 'u2', input: 7 });
    appendFileSync(file, appendedLine);

    const second = await scan();
    assert.equal(second.stats.appended, 1, '应该走增量路径');
    assert.equal(second.stats.full, 0, '不应该退回全量');
    assert.equal(second.bySource['claude-code'].length, 2, '旧记录来自缓存，新记录来自增量读');
    assert.ok(
      second.stats.bytesRead < firstBytes + appendedLine.length,
      `只应读新增部分，实际读了 ${second.stats.bytesRead}`,
    );
  });
});

test('文件被重写时退回全量，不沿用旧 offset', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(file, assistantLine('2026-07-30T10:00:00Z', { id: 'm1', uuid: 'u1', input: 999 }));
    await scan();

    // 内容整体替换但长度更长：尾部指纹不吻合，必须重读。
    writeFileSync(
      file,
      assistantLine('2026-07-30T11:00:00Z', { id: 'm9', uuid: 'u9', input: 111 })
      + assistantLine('2026-07-30T11:01:00Z', { id: 'm8', uuid: 'u8', input: 222 }),
    );
    const result = await scan();
    assert.equal(result.stats.full, 1, '重写必须走全量');
    const inputs = result.bySource['claude-code'].map((r) => r.input).sort((a, b) => a - b);
    assert.deepEqual(inputs, [111, 222], '旧内容不得残留');
  });
});

test('半截行不被消费，等下次补齐后再解析', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(file, assistantLine('2026-07-30T10:00:00Z', { id: 'm1', uuid: 'u1' }));
    await scan();

    // 追加一个没有换行结尾的不完整 JSON
    const partial = assistantLine('2026-07-30T10:05:00Z', { id: 'm2', uuid: 'u2' }).trimEnd();
    appendFileSync(file, partial.slice(0, partial.length - 20));
    const mid = await scan();
    assert.equal(mid.bySource['claude-code'].length, 1, '半截行不能计入');

    // 补齐剩余部分与换行
    appendFileSync(file, `${partial.slice(partial.length - 20)}\n`);
    const done = await scan();
    assert.equal(done.bySource['claude-code'].length, 2, '补齐后应被计入');
  });
});

test('日志被删除后缓存条目被逐出', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(file, assistantLine('2026-07-30T10:00:00Z', { id: 'm1', uuid: 'u1' }));
    await scan();
    rmSync(file);
    const result = await scan();
    assert.equal(result.bySource['claude-code'].length, 0);
  });
});

test('预算耗尽后下次扫描从被饿死的来源开始，并公开每来源完整度', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-fair-scan-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const files = [join(root, 'slow-1.jsonl'), join(root, 'slow-2.jsonl'), join(root, 'waiting.jsonl')];
  writeFileSync(files[0], '{"value":1}\n');
  writeFileSync(files[1], '{"value":2}\n');
  writeFileSync(files[2], '{"value":3}\n');

  let fakeNow = 0;
  const parser = (id, fileOrFiles, delayMs = 0) => ({
    id,
    discover: () => (Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]).map((file, index) => {
      const stat = statSync(file);
      return { path: file, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: `${id}-${index}` };
    }),
    createFileParser: () => {
      const records = [];
      return {
        onObject(obj) {
          fakeNow += delayMs;
          records.push({ source: id, model: 'm', project: 'p', ts: 1,
            input: obj.value, output: 0, cacheRead: 0, write5m: 0, write1h: 0,
            reasoning: 0, messageId: `${id}-${obj.value}`, requestId: null,
            uuid: null, sidechain: false });
        },
        finish: () => ({ records }),
      };
    },
  });
  const slow = parser('slow', files.slice(0, 2), 8);
  const waiting = parser('waiting', files[2]);
  const { scanAll } = await import('../src/runtime/scan.js');

  try {
    const options = {
      parsers: [slow, waiting], budgetMs: 2, ignoreSettings: true,
      clock: () => fakeNow,
    };
    const first = await scanAll(options);
    assert.equal(first.bySource.waiting.length, 0);
    assert.equal(first.sourceStatus.slow.deferredFiles, 1,
      '慢来源自己仍有文件待处理，不能让它连续霸占下一轮起点');
    assert.equal(first.sourceStatus.waiting.complete, false);
    assert.equal(first.sourceStatus.waiting.deferredFiles, 1);

    const second = await scanAll(options);
    assert.equal(second.bySource.waiting.length, 1,
      '持久化调度游标必须让下一轮先处理上次没机会运行的来源');
    assert.equal(second.sourceStatus.waiting.complete, true);
    assert.equal(second.sourceStatus.waiting.indexedFiles, 1);
    assert.equal(second.sourceStatus.waiting.latestRecordAt, 1);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('冷索引预算有限时优先处理最近文件，让今天用量先可见', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-recent-first-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const oldFile = join(root, 'old.jsonl');
  const newFile = join(root, 'new.jsonl');
  writeFileSync(oldFile, '{"value":1,"ts":100}\n');
  writeFileSync(newFile, '{"value":2,"ts":200}\n');

  let firstParsed = true;
  const parser = {
    id: 'recent-first',
    // 刻意把旧文件放前面，模拟按年份/目录自然遍历得到的顺序。
    discover: () => [
      { path: oldFile, size: statSync(oldFile).size, mtimeMs: 100, ino: statSync(oldFile).ino,
        sessionId: 'old' },
      { path: newFile, size: statSync(newFile).size, mtimeMs: 200, ino: statSync(newFile).ino,
        sessionId: 'new' },
    ],
    createFileParser: () => {
      const records = [];
      return {
        onObject(obj) {
          if (firstParsed) {
            firstParsed = false;
            const until = Date.now() + 8;
            while (Date.now() < until) { /* consume this round's budget */ }
          }
          records.push({ source: 'recent-first', model: 'm', project: 'p', ts: obj.ts,
            input: obj.value, output: 0, cacheRead: 0, write5m: 0, write1h: 0,
            reasoning: 0, messageId: String(obj.ts), requestId: null,
            uuid: null, sidechain: false });
        },
        finish: () => ({ records }),
      };
    },
  };
  const { scanAll } = await import('../src/runtime/scan.js');
  try {
    const result = await scanAll({ parsers: [parser], budgetMs: 2, ignoreSettings: true });
    assert.equal(result.bySource['recent-first'][0]?.ts, 200,
      '首轮有限预算应先产出最近文件，而不是从最旧历史开始');
    assert.equal(result.sourceStatus['recent-first'].deferredFiles, 1);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('单个超大行日志分块续读，不让一个文件突破整轮预算', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-chunked-file-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const log = join(root, 'large.jsonl');
  const first = '{"value":1,"ts":100}\n';
  const second = '{"value":2,"ts":200}\n';
  writeFileSync(log, first + second);
  const parser = {
    id: 'chunked-file',
    discover: () => [{
      path: log, size: statSync(log).size, mtimeMs: statSync(log).mtimeMs,
      ino: statSync(log).ino, sessionId: 'one',
    }],
    createFileParser: () => {
      const records = [];
      return {
        onObject(obj) {
          records.push({ source: 'chunked-file', model: 'm', project: 'p', ts: obj.ts,
            input: obj.value, output: 0, cacheRead: 0, write5m: 0, write1h: 0,
            reasoning: 0, messageId: String(obj.ts), requestId: null,
            uuid: null, sidechain: false });
        },
        finish: () => ({ records }),
      };
    },
  };
  const { scanAll } = await import('../src/runtime/scan.js');
  try {
    const partial = await scanAll({
      parsers: [parser], budgetMs: 1_000, maxFileBytes: first.length, ignoreSettings: true,
    });
    assert.deepEqual(partial.bySource['chunked-file'].map((r) => r.ts), [100]);
    assert.equal(partial.sourceStatus['chunked-file'].deferredFiles, 1);
    assert.equal(partial.sourceStatus['chunked-file'].complete, false);

    const complete = await scanAll({
      parsers: [parser], budgetMs: 1_000, maxFileBytes: first.length, ignoreSettings: true,
    });
    assert.deepEqual(complete.bySource['chunked-file'].map((r) => r.ts), [100, 200]);
    assert.equal(complete.sourceStatus['chunked-file'].complete, true);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('分块点落在长行中间时只读到该行结尾，不退回整个文件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-long-line-boundary-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const log = join(root, 'long.jsonl');
  const first = `${JSON.stringify({ value: 1, ts: 100, padding: 'x'.repeat(10_000) })}\n`;
  const second = `${JSON.stringify({ value: 2, ts: 200 })}\n`;
  writeFileSync(log, first + second);
  const parser = {
    id: 'long-line-boundary',
    discover: () => [{ path: log, size: statSync(log).size, mtimeMs: statSync(log).mtimeMs,
      ino: statSync(log).ino, sessionId: 'one' }],
    createFileParser: () => {
      const records = [];
      return {
        onObject(obj) {
          records.push({ source: 'long-line-boundary', model: 'm', project: 'p', ts: obj.ts,
            input: obj.value, output: 0, cacheRead: 0, write5m: 0, write1h: 0,
            reasoning: 0, messageId: String(obj.ts), requestId: null,
            uuid: null, sidechain: false });
        },
        finish: () => ({ records }),
      };
    },
  };
  const { scanAll } = await import('../src/runtime/scan.js');
  try {
    const partial = await scanAll({
      parsers: [parser], budgetMs: 1_000, maxFileBytes: 100, ignoreSettings: true,
    });
    assert.deepEqual(partial.bySource['long-line-boundary'].map((r) => r.ts), [100]);
    assert.equal(partial.stats.bytesRead, first.length);
    assert.equal(partial.sourceStatus['long-line-boundary'].deferredFiles, 1);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('整份 JSON 和数据库模式不分块，不会永久停在 deferred', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-non-line-mode-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const whole = join(root, 'thread.json');
  const database = join(root, 'usage.sqlite');
  writeFileSync(whole, JSON.stringify({ value: 7, padding: 'x'.repeat(1_000) }) + '\n');
  writeFileSync(database, 'not-a-real-db-but-the-parser-owns-reading-it');
  const candidate = (path) => ({ path, size: statSync(path).size,
    mtimeMs: statSync(path).mtimeMs, ino: statSync(path).ino, sessionId: path });
  const makeRecord = (source, value) => ({ source, model: 'm', project: 'p', ts: 100,
    input: value, output: 0, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0,
    messageId: source, requestId: null, uuid: null, sidechain: false });
  const parsers = [
    {
      id: 'whole-mode', readMode: 'whole', discover: () => [candidate(whole)],
      createFileParser: () => {
        const records = [];
        return { onObject: (obj) => records.push(makeRecord('whole-mode', obj.value)),
          finish: () => ({ records }) };
      },
    },
    {
      id: 'none-mode', readMode: 'none', discover: () => [candidate(database)],
      createFileParser: () => ({ finish: () => ({ records: [makeRecord('none-mode', 9)] }) }),
    },
  ];
  const { scanAll } = await import('../src/runtime/scan.js');
  try {
    const result = await scanAll({
      parsers, budgetMs: 1_000, maxFileBytes: 10, ignoreSettings: true,
    });
    assert.equal(result.bySource['whole-mode'][0]?.input, 7);
    assert.equal(result.bySource['none-mode'][0]?.input, 9);
    assert.equal(result.sourceStatus['whole-mode'].complete, true);
    assert.equal(result.sourceStatus['none-mode'].complete, true);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('来源目录读取失败时标为不完整，不能把权限错误当成精确零值', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-discovery-error-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const notDirectory = join(root, 'not-a-directory');
  writeFileSync(notDirectory, 'x');
  const parser = {
    id: 'broken-root',
    discover: ({ listJsonl }) => listJsonl(notDirectory),
    createFileParser: () => ({ finish: () => ({ records: [] }) }),
  };
  const { scanAll } = await import('../src/runtime/scan.js');
  try {
    const result = await scanAll({ parsers: [parser], budgetMs: 1000, ignoreSettings: true });
    assert.equal(result.sourceStatus['broken-root'].complete, false);
    assert.equal(result.sourceStatus['broken-root'].failedFiles, 1);
    assert.match(result.warnings.join('\n'), /无法读取/);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('discover 瞬时失败时保留该来源缓存，不发布空值也不逐出', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-discover-fallback-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const file = join(root, 'usage.jsonl');
  writeFileSync(file, '{"value":7}\n');
  let fail = false;
  const parser = {
    id: 'flaky',
    discover: () => {
      if (fail) throw new Error('temporary failure');
      const stat = statSync(file);
      return [{ path: file, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
        sessionId: 'flaky' }];
    },
    createFileParser: () => {
      const records = [];
      return {
        onObject(obj) {
          records.push({ source: 'flaky', model: 'm', project: 'p', ts: 1,
            input: obj.value, output: 0, cacheRead: 0, write5m: 0, write1h: 0,
            reasoning: 0, messageId: 'flaky-1', requestId: null, uuid: null,
            sidechain: false });
        },
        finish: () => ({ records }),
      };
    },
  };
  const { scanAll } = await import('../src/runtime/scan.js');
  try {
    const first = await scanAll({ parsers: [parser], budgetMs: 1000, ignoreSettings: true });
    assert.equal(first.bySource.flaky.length, 1);
    fail = true;
    const second = await scanAll({ parsers: [parser], budgetMs: 1000, ignoreSettings: true });
    assert.equal(second.sourceStatus.flaky.complete, false);
    assert.equal(second.bySource.flaky.length, 1, '瞬时故障必须回落到上一份缓存');
    fail = false;
    const third = await scanAll({ parsers: [parser], budgetMs: 1000, ignoreSettings: true });
    assert.equal(third.bySource.flaky.length, 1, '失败轮次不能把缓存逐出');
    assert.equal(third.stats.reused, 1);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('云端解析器的缓存 TTL 到期后重新拉取，未到期时复用', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cloud-ttl-'));
  const previous = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  const file = join(root, 'state.vscdb');
  writeFileSync(file, 'stable');
  let now = 1_800_000_000_000;
  let pulls = 0;
  const parser = {
    id: 'cloud-source',
    readMode: 'none',
    cacheTtlMs: (candidate) => (
      candidate.path === file ? 10 * 60 * 1000 : null
    ),
    discover: () => {
      const stat = statSync(file);
      return [{ path: file, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }];
    },
    createFileParser: () => ({
      finish: () => ({
        records: [{
          source: 'cloud-source', model: 'm', ts: now, input: ++pulls,
          output: 0, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0,
          messageId: `pull-${pulls}`, requestId: null, uuid: null, sidechain: false,
        }],
      }),
    }),
  };
  const { scanAll } = await import('../src/runtime/scan.js');
  const scan = () => scanAll({
    parsers: [parser], budgetMs: 1000, ignoreSettings: true, clock: () => now,
  });

  try {
    const first = await scan();
    assert.equal(first.bySource['cloud-source'][0].input, 1);
    now += 9 * 60 * 1000;
    const cached = await scan();
    assert.equal(cached.stats.reused, 1);
    assert.equal(cached.bySource['cloud-source'][0].input, 1);
    now += 2 * 60 * 1000;
    const refreshed = await scan();
    assert.equal(refreshed.stats.full, 1);
    assert.equal(refreshed.bySource['cloud-source'][0].input, 2);
  } finally {
    if (previous === undefined) delete process.env.MACLAWD_DATA_DIR;
    else process.env.MACLAWD_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('会话时长跨增量尾读保持连续', async () => {
  await withFixture(async ({ file, scan }) => {
    writeFileSync(
      file,
      userLine('2026-07-30T10:00:00Z', 'q1')
      + assistantLine('2026-07-30T10:00:10Z', { id: 'm1', uuid: 'u1' })
      + assistantLine('2026-07-30T10:00:40Z', { id: 'm2', uuid: 'u2' }),
    );
    const first = await scan();
    const s1 = first.sessionsBySource['claude-code'][0];
    assert.equal(s1.activeSeconds, 30, '首个回复到最后一个回复 = 30s，等待不计入');

    appendFileSync(file, assistantLine('2026-07-30T10:01:10Z', { id: 'm3', uuid: 'u3' }));
    const second = await scan();
    assert.equal(second.stats.appended, 1);
    const s2 = second.sessionsBySource['claude-code'][0];
    // 首个回复 10:00:10 → 最后回复 10:01:10 = 60s。
    // 若轮次状态没能跨增量读延续，turnStart 会是 null，这里只会得到 0。
    assert.equal(s2.activeSeconds, 60, '增量读后轮次状态必须接着算，而不是从 0 重来');
    assert.equal(s2.messageCount, 4, '消息计数同样要跨增量读累加');
  });
});

// ---------- 会话指标算法 ----------

test('activeSeconds 排除排队与首字等待', () => {
  const t = createTurnTracker();
  const base = new Date('2026-07-30T10:00:00Z').getTime();
  t.onEvent('user', base);                    // 提问
  t.onEvent('assistant', base + 20_000);      // 20s 后首个回复 —— 这 20s 不算
  t.onEvent('assistant', base + 50_000);      // 生成持续到 50s
  const snapshot = t.snapshot();
  assert.equal(snapshot.activeSeconds, 30);
  assert.equal(snapshot.durationSeconds, 50, '墙钟包含等待');
});

test('多轮的活跃时长累加，轮间空闲不计入', () => {
  const t = createTurnTracker();
  const base = new Date('2026-07-30T10:00:00Z').getTime();
  t.onEvent('user', base);
  t.onEvent('assistant', base + 1_000);
  t.onEvent('assistant', base + 11_000);      // 第一轮 10s
  t.onEvent('user', base + 600_000);          // 十分钟后才提下一个问题
  t.onEvent('assistant', base + 601_000);
  t.onEvent('assistant', base + 606_000);     // 第二轮 5s
  assert.equal(t.snapshot().activeSeconds, 15);
});

test('snapshot 可重复调用且不改变状态', () => {
  const t = createTurnTracker();
  const base = Date.now();
  t.onEvent('user', base);
  t.onEvent('assistant', base + 1000);
  t.onEvent('assistant', base + 5000);
  assert.equal(t.snapshot().activeSeconds, t.snapshot().activeSeconds);
});

test('没有任何消息时 snapshot 返回 null', () => {
  assert.equal(createTurnTracker().snapshot(), null);
});

test('summarizeSessions 按时间窗过滤', () => {
  const sessions = [
    { firstTs: 1000, lastTs: 2000, activeSeconds: 10, durationSeconds: 1, messageCount: 2, userMessageCount: 1, userPromptHours: new Array(24).fill(0) },
    { firstTs: 9000, lastTs: 9500, activeSeconds: 5, durationSeconds: 1, messageCount: 3, userMessageCount: 1, userPromptHours: new Array(24).fill(0) },
  ];
  assert.equal(summarizeSessions(sessions).activeSeconds, 15);
  assert.equal(summarizeSessions(sessions, { from: 5000 }).activeSeconds, 5);
  assert.equal(summarizeSessions(sessions, { from: 5000 }).sessions, 1);
});

// ---------- 强度映射 ----------

test('强度映射单调、有界、零速率为零', () => {
  assert.equal(intensityFromRate(0), 0);
  assert.equal(intensityFromRate(-5), 0);
  const low = intensityFromRate(5_000);
  const mid = intensityFromRate(60_000);
  const high = intensityFromRate(500_000);
  assert.ok(low < mid && mid < high, '必须单调递增');
  assert.ok(high < 1, '饱和但不越界');
  assert.ok(low > 0);
});
