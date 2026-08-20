import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMessage, firstMessage, firstString, firstVarint } from '../src/runtime/parsers/protobuf.js';
import { parseGenMetadata } from '../src/runtime/parsers/antigravity.js';
import * as gemini from '../src/runtime/parsers/gemini-cli.js';
import * as copilot from '../src/runtime/parsers/copilot-cli.js';
import * as pi from '../src/runtime/parsers/pi-coding-agent.js';
import * as openclaw from '../src/runtime/parsers/openclaw.js';
import * as droid from '../src/runtime/parsers/droid.js';
import * as amp from '../src/runtime/parsers/amp.js';
import { taskToRecord } from '../src/runtime/parsers/vscode-forks.js';
import { parseCsv, parseCursorUsageCsv } from '../src/runtime/parsers/cursor.js';
import { parsers, VERIFIED_SOURCES } from '../src/runtime/parsers/index.js';
import { billable, throughput } from '../src/runtime/usage-record.js';

function run(parser, objects, candidate = { path: '/tmp/x.jsonl', sessionId: 's1' }) {
  const fp = parser.createFileParser({ state: null, candidate });
  for (const obj of objects) fp.onObject(obj);
  return fp.finish();
}

// ---------- 注册表契约 ----------

test('每个解析器都实现了完整接口', () => {
  for (const p of parsers) {
    assert.ok(typeof p.id === 'string' && p.id, `缺 id: ${p.label}`);
    assert.ok(typeof p.label === 'string' && p.label, `${p.id} 缺 label`);
    assert.equal(typeof p.dataDirs, 'function', `${p.id} 缺 dataDirs`);
    assert.equal(typeof p.discover, 'function', `${p.id} 缺 discover`);
    assert.equal(typeof p.createFileParser, 'function', `${p.id} 缺 createFileParser`);
    assert.ok(['lines', 'whole', 'none', undefined].includes(p.readMode), `${p.id} readMode 非法`);
  }
});

test('Codex 数据源统一显示为 Codex', () => {
  assert.equal(parsers.find((parser) => parser.id === 'codex')?.label, 'Codex');
});

test('id 不重复，且覆盖 vibe-usage 的全部工具', () => {
  const ids = parsers.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id 有重复');
  // vibe-usage 的 20 个 source
  for (const id of [
    'claude-code', 'codex', 'grok', 'copilot-cli', 'cursor', 'gemini-cli',
    'opencode', 'openclaw', 'pi-coding-agent', 'qwen-code', 'kimi-code',
    'amp', 'droid', 'antigravity', 'trae-cli', 'hermes', 'kiro',
    'cline', 'roo-code', 'zcode',
  ]) {
    assert.ok(ids.includes(id), `缺 ${id}`);
  }
});

test('已验证集合只包含真机核对过的 source', () => {
  const ids = new Set(parsers.map((p) => p.id));
  for (const id of VERIFIED_SOURCES) assert.ok(ids.has(id), `${id} 不在注册表里`);
  // 把「已支持」和「已验证」分开说是诚实底线，不能全都标成已验证
  assert.ok(VERIFIED_SOURCES.size < parsers.length);
});

// ---------- protobuf 解码器（可独立验证） ----------

/** 手工构造 protobuf 字节，用来验证解码器本身而不依赖任何 schema 猜测。 */
function varint(n) {
  const out = [];
  let value = n;
  while (value > 127) { out.push((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
  out.push(value);
  return out;
}
const tag = (field, wire) => varint(field * 8 + wire);
const vField = (field, n) => [...tag(field, 0), ...varint(n)];
const bField = (field, buf) => [...tag(field, 2), ...varint(buf.length), ...buf];
const sField = (field, s) => bField(field, [...Buffer.from(s, 'utf8')]);

test('protobuf 解码 varint / 字符串 / 嵌套消息', () => {
  const inner = Buffer.from([...vField(3, 42), ...sField(4, '你好')]);
  const buf = Buffer.from([...vField(1, 7), ...bField(2, [...inner])]);
  const fields = decodeMessage(buf);
  assert.equal(firstVarint(fields, 1), 7);
  const nested = firstMessage(fields, 2);
  assert.equal(firstVarint(nested, 3), 42);
  assert.equal(firstString(nested, 4), '你好');
});

test('protobuf varint 支持超过 32 位的 token 计数', () => {
  // 位运算是 32 位的；用位移实现会在这里溢出
  const big = 9_876_543_210;
  const fields = decodeMessage(Buffer.from(vField(1, big)));
  assert.equal(firstVarint(fields, 1), big);
});

test('protobuf 遇到损坏字节抛错而不是返回垃圾', () => {
  assert.throws(() => decodeMessage(Buffer.from([0x08])), /截断/);
  assert.throws(() => decodeMessage(Buffer.from([0x12, 0x7f, 0x01])), /越界/);
});

test('firstMessage 解不开子结构时返回 undefined 而不抛错', () => {
  const buf = Buffer.from(bField(1, [0x12, 0x7f, 0x01]));
  assert.equal(firstMessage(decodeMessage(buf), 1), undefined);
});

// ---------- antigravity：schema 自校验 ----------

test('antigravity 按逆向字段号解出用量', () => {
  const usage = [...vField(2, 1000), ...vField(3, 200), ...vField(5, 5000), ...vField(9, 50), ...sField(11, 'resp-1')];
  const createdAt = [...vField(1, 1_700_000_000)];
  const startMeta = [...bField(4, createdAt)];
  const chatModel = [...bField(4, usage), ...bField(9, startMeta), ...sField(21, 'Gemini 3 Pro')];
  const blob = Buffer.from(bField(1, chatModel));

  const parsed = parseGenMetadata(blob);
  assert.equal(parsed.input, 1000);
  assert.equal(parsed.output, 200);
  assert.equal(parsed.cacheRead, 5000);
  assert.equal(parsed.thinking, 50);
  assert.equal(parsed.responseId, 'resp-1');
  assert.equal(parsed.model, 'Gemini 3 Pro');
  assert.equal(parsed.ts, 1_700_000_000_000);
});

test('antigravity schema 不匹配时返回 null，不产出错误数字', () => {
  // 这是本项目对「字段号是猜的」这件事的兜底：读不到 > 读错
  assert.equal(parseGenMetadata(Buffer.from([])), null);
  assert.equal(parseGenMetadata(Buffer.from(vField(1, 5))), null, '字段 1 不是消息');
  assert.equal(parseGenMetadata(Buffer.from(bField(1, vField(99, 1)))), null, '没有 usage 子消息');
  // 全零用量（报错步骤，或 schema 猜错）
  const zero = [...bField(4, [...vField(2, 0), ...vField(3, 0)])];
  assert.equal(parseGenMetadata(Buffer.from(bField(1, zero))), null);
});

// ---------- 各解析器的不变量 ----------

test('Gemini：input 含缓存要减掉，thoughts 是 output 子集', () => {
  const { records } = run(gemini, [{
    timestamp: '2026-07-30T10:00:00Z',
    message: { model: 'gemini-3-pro', tokens: { input: 10_000, output: 500, cached: 8_000, thoughts: 120 } },
  }]);
  const r = records[0];
  assert.equal(r.input, 2000, '10000 - 8000');
  assert.equal(r.cacheRead, 8000);
  assert.equal(r.output, 500);
  assert.equal(r.reasoning, 120);
  assert.equal(billable(r), 2500);
  assert.equal(throughput(r), 10_500);
});

test('Gemini 兼容旧版 usageMetadata 字段名', () => {
  const { records } = run(gemini, [{
    timestamp: '2026-07-30T10:00:00Z',
    message: {
      usageMetadata: {
        promptTokenCount: 300, candidatesTokenCount: 40,
        cachedContentTokenCount: 100, thoughtsTokenCount: 10,
      },
    },
  }]);
  assert.equal(records[0].input, 200);
  assert.equal(records[0].cacheRead, 100);
});

test('Copilot：一个 shutdown 事件按模型拆多条，input 含缓存读', () => {
  const { records } = run(copilot, [
    { cwd: '/Users/rain/proj' },
    {
      type: 'session.shutdown',
      timestamp: '2026-07-30T10:00:00Z',
      data: {
        modelMetrics: {
          'gpt-5': { usage: { inputTokens: 5000, cacheReadTokens: 4000, cacheWriteTokens: 200, outputTokens: 100 } },
          'gpt-5-mini': { usage: { inputTokens: 100, outputTokens: 10 } },
        },
      },
    },
  ]);
  assert.equal(records.length, 2);
  const big = records.find((r) => r.model === 'gpt-5');
  assert.equal(big.input, 1000, '5000 - 4000');
  assert.equal(big.cacheRead, 4000);
  assert.equal(big.write5m, 200);
  assert.equal(big.cwd, '/Users/rain/proj');
});

test('pi：字段互不重叠，不做减法，按 id 去重', () => {
  const { records } = run(pi, [{
    id: 'e1',
    timestamp: '2026-07-30T10:00:00Z',
    message: { role: 'assistant', model: 'pi-1', usage: { input: 100, output: 50, cacheRead: 900, cacheWrite: 20 } },
  }]);
  const r = records[0];
  assert.equal(r.input, 100);
  assert.equal(r.cacheRead, 900);
  assert.equal(r.write5m, 20);
  assert.equal(r.messageId, 'e1');
});

test('pi 忽略非 assistant 角色', () => {
  const { records } = run(pi, [{
    timestamp: '2026-07-30T10:00:00Z',
    message: { role: 'user', usage: { input: 100 } },
  }]);
  assert.equal(records.length, 0);
});

test('OpenClaw 用别名池吃下不同供应商的字段命名', () => {
  const a = run(openclaw, [{
    timestamp: '2026-07-30T10:00:00Z',
    message: { model: 'm', usage: { promptTokens: 100, completionTokens: 20, cache_read_input_tokens: 300 } },
  }]).records[0];
  assert.equal(a.input, 100);
  assert.equal(a.output, 20);
  assert.equal(a.cacheRead, 300);
});

test('Droid：input 含缓存，output 含 thinking，一个会话一条记录', () => {
  // 用不到 settings 文件的分支：没有旁挂文件时不产出记录
  const { records } = run(droid, [
    { type: 'message', timestamp: '2026-07-30T10:00:00Z', cwd: '/p' },
  ], { path: '/tmp/no-such-session.jsonl' });
  assert.equal(records.length, 0, '缺 settings.json 时不应臆造用量');
});

test('Amp 优先用账本，并从关联消息取缓存读', () => {
  const { records } = run(amp, [{
    id: 'T-1',
    created: '2026-07-30T09:00:00Z',
    messages: [{ usage: { cacheReadInputTokens: 7000 } }],
    usageLedger: {
      events: [{ timestamp: '2026-07-30T10:00:00Z', model: 'amp-1', toMessageId: 0, tokens: { input: 300, output: 40 } }],
    },
  }], { path: '/tmp/T-1.json' });
  const r = records[0];
  assert.equal(r.input, 300);
  assert.equal(r.output, 40);
  assert.equal(r.cacheRead, 7000, '账本事件本身不带缓存读，要回到消息去取');
  assert.equal(r.model, 'amp-1');
});

test('Amp 没有账本时回落到消息自身的 usage', () => {
  const { records } = run(amp, [{
    id: 'T-2',
    created: '2026-07-30T09:00:00Z',
    messages: [{ timestamp: '2026-07-30T09:30:00Z', usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 1 } }],
  }], { path: '/tmp/T-2.json' });
  assert.equal(records.length, 1);
  assert.equal(records[0].input, 10);
});

test('Cline / Roo：tokensIn 是非缓存输入，三项互斥', () => {
  const r = taskToRecord({
    id: 'task-1', ts: 1_700_000_000_000,
    tokensIn: 100, tokensOut: 50, cacheWrites: 300, cacheReads: 9000,
    model: 'claude-sonnet-5',
  }, { source: 'cline' });
  assert.equal(r.input, 100);
  assert.equal(r.write5m, 300);
  assert.equal(r.cacheRead, 9000);
  assert.equal(billable(r), 450);
  assert.equal(r.messageId, 'task-1');
});

test('Cline / Roo 全零任务不产出记录', () => {
  assert.equal(taskToRecord({ id: 'x', ts: 1, tokensIn: 0, tokensOut: 0 }, { source: 'cline' }), null);
});

test('Cursor CSV 解析支持引号与转义', () => {
  const rows = parseCsv('Date,Model,Input Tokens\n"2026-07-30","gpt-5","1,000"\n"a""b",m,5\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Model, 'gpt-5');
  assert.equal(rows[0]['Input Tokens'], '1,000');
  assert.equal(rows[1].Date, 'a"b');
});

test('Cursor 按 dashboard 真实表头拆分输入、缓存读与输出', () => {
  const records = parseCursorUsageCsv([
    'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens',
    '2026-07-30,gpt-5,100,20,"1,000",30',
    '2026-07-30,gpt-5,100,20,"1,000",30',
  ].join('\n'));

  assert.equal(records.length, 2, '相同用量的两次请求不能被错误去重');
  assert.deepEqual(
    records.map(({ input, output, cacheRead, write5m }) => ({ input, output, cacheRead, write5m })),
    [
      { input: 120, output: 30, cacheRead: 1000, write5m: 0 },
      { input: 120, output: 30, cacheRead: 1000, write5m: 0 },
    ],
  );
  assert.notEqual(records[0].messageId, records[1].messageId);
  assert.equal(records[0].ts, Date.parse('2026-07-30T00:00:00Z'));
});

test('Cursor 记录身份不依赖云端 CSV 的行顺序', () => {
  const header = 'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens';
  const a = '2026-07-30,gpt-5,100,20,1000,30';
  const b = '2026-07-31,claude-4,200,40,2000,60';
  const first = parseCursorUsageCsv([header, a, b].join('\n'));
  const reordered = parseCursorUsageCsv([header, b, a].join('\n'));

  assert.deepEqual(
    first.map((record) => record.messageId).sort(),
    reordered.map((record) => record.messageId).sort(),
  );
});

test('Cursor 云端默认关闭时仍允许本地日志候选', () => {
  const local = {
    path: '/tmp/cursor.hooks.workspaceId-test.log', size: 1, mtimeMs: 2, ino: 3,
  };
  const cursorParser = parsers.find((p) => p.id === 'cursor');
  assert.deepEqual(
    cursorParser.discover({
      listJsonl: (dir) => (dir === cursorParser.cursorLogsDir() ? [local] : []),
    }),
    [{ ...local, sessionId: local.path, fallbackProject: null, kind: 'local-hook-log' }],
  );
});

// ---------- Stop 判定 ----------

test('stop-disposition：end_turn 才算完成', async () => {
  const { readStopDisposition, shouldCelebrate, DISPOSITION } =
    await import('../src/runtime/stop-disposition.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'maclawd-stop-'));
  const line = (reason) => `${JSON.stringify({
    type: 'assistant',
    message: { id: 'm', model: 'x', stop_reason: reason, stop_details: null },
  })}\n`;
  try {
    const done = join(dir, 'done.jsonl');
    writeFileSync(done, line('tool_use') + line('end_turn'));
    assert.equal(await readStopDisposition(done), DISPOSITION.complete);
    assert.equal(shouldCelebrate(await readStopDisposition(done)), true);

    // 停在工具调用上 —— 模型还想继续却收到了 Stop
    const cut = join(dir, 'cut.jsonl');
    writeFileSync(cut, line('end_turn') + line('tool_use'));
    assert.equal(await readStopDisposition(cut), DISPOSITION.inconclusive);
    assert.equal(shouldCelebrate(await readStopDisposition(cut)), false);

    // 读不到 / 空文件 / 没有 assistant 记录，一律 unknown 且不庆祝
    assert.equal(await readStopDisposition(join(dir, 'nope.jsonl')), DISPOSITION.unknown);
    const empty = join(dir, 'empty.jsonl');
    writeFileSync(empty, '');
    assert.equal(await readStopDisposition(empty), DISPOSITION.unknown);
    assert.equal(await readStopDisposition(null), DISPOSITION.unknown);
    assert.equal(shouldCelebrate(DISPOSITION.unknown), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
