import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
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
