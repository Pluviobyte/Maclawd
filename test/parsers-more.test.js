import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as codex from '../src/runtime/parsers/codex.js';
import * as kimi from '../src/runtime/parsers/kimi-code.js';
import * as qwen from '../src/runtime/parsers/qwen-code.js';
import * as grok from '../src/runtime/parsers/grok.js';
import { dedupe } from '../src/runtime/dedupe.js';
import { billable, throughput } from '../src/runtime/usage-record.js';

function runParser(parser, objects, candidate = { path: '/tmp/x.jsonl' }) {
  const fp = parser.createFileParser({ state: null, candidate });
  for (const obj of objects) fp.onObject(obj);
  return fp.finish();
}

// ---------- Codex ----------

/** 取自 ~/.codex 真实 rollout 的 token_count 事件。 */
function codexTokenCount(total, last, timestamp = '2026-07-18T16:03:27.437Z') {
  return {
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
  };
}

const CODEX_USAGE = {
  input_tokens: 28161,
  cached_input_tokens: 11008,
  cache_write_input_tokens: 0,
  output_tokens: 370,
  reasoning_output_tokens: 189,
  total_tokens: 28531,
};

test('Codex：input 含缓存，减掉后三项互斥（不变量 1）', () => {
  const { records } = runParser(codex, [codexTokenCount(CODEX_USAGE, CODEX_USAGE)]);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.input, 28161 - 11008, '17153');
  assert.equal(r.cacheRead, 11008);
  assert.equal(r.output, 370);
  assert.equal(r.reasoning, 189, 'reasoning ⊂ output（不变量 2）');
  assert.equal(billable(r), 17153 + 370);
  assert.equal(throughput(r), 17153 + 370 + 11008);
});

test('Codex：累计总量未前进的重复发射计零', () => {
  // 同一累计总量连写两次 —— 真实 API 调用必然让累计计数器前进。
  const { records } = runParser(codex, [
    codexTokenCount(CODEX_USAGE, CODEX_USAGE),
    codexTokenCount(CODEX_USAGE, CODEX_USAGE),
  ]);
  assert.equal(records.length, 1, '第二条是重复发射');
});

test('Codex：缺 last_token_usage 时用累计差值', () => {
  const first = { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, total_tokens: 1100 };
  const second = { input_tokens: 2500, cached_input_tokens: 0, output_tokens: 250, total_tokens: 2750 };
  const { records } = runParser(codex, [
    { timestamp: '2026-07-18T16:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: first } } },
    { timestamp: '2026-07-18T16:01:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: second } } },
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].input, 1000, '首条累计值直接采用');
  assert.equal(records[1].input, 1500, '差值 2500-1000');
  assert.equal(records[1].output, 150);
});

test('Codex：负差值视为计数器重置，用当前累计值作新基线', () => {
  const high = { input_tokens: 5000, cached_input_tokens: 0, output_tokens: 500, total_tokens: 5500 };
  const reset = { input_tokens: 800, cached_input_tokens: 0, output_tokens: 80, total_tokens: 880 };
  const { records } = runParser(codex, [
    { timestamp: '2026-07-18T16:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: high } } },
    { timestamp: '2026-07-18T16:01:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: reset } } },
  ]);
  // 允许负数会让 compaction 后的一条把已记录的合法用量抵消掉。
  assert.equal(records.length, 2);
  assert.ok(records[1].input >= 0);
  assert.equal(records[1].input, 800);
});

test('Codex：模型名来自 turn_context，项目来自 session_meta', () => {
  const { records } = runParser(codex, [
    { timestamp: '2026-07-18T16:00:00Z', type: 'session_meta', payload: { id: 'sess-1', cwd: '/Users/rain/Desktop/内容创作' } },
    { timestamp: '2026-07-18T16:00:01Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    codexTokenCount(CODEX_USAGE, CODEX_USAGE),
  ]);
  assert.equal(records[0].model, 'gpt-5.6-sol');
  assert.equal(records[0].cwd, '/Users/rain/Desktop/内容创作');
});

test('Codex：只有第一个 session_meta 是本文件正身', () => {
  const { state } = runParser(codex, [
    { timestamp: '2026-07-18T16:00:00Z', type: 'session_meta', payload: { id: 'canonical' } },
    { timestamp: '2026-07-18T16:00:01Z', type: 'session_meta', payload: { id: 'replayed-parent' } },
  ]);
  assert.equal(state.canonicalSessionId, 'canonical');
});

test('Codex：快照键让跨文件的 fork 重放前缀自然折叠', () => {
  // fork 的 rollout 会逐条复制父会话的 token_count，两份快照完全相同。
  const parent = runParser(codex, [codexTokenCount(CODEX_USAGE, CODEX_USAGE)], { path: '/tmp/parent.jsonl' });
  const child = runParser(codex, [codexTokenCount(CODEX_USAGE, CODEX_USAGE)], { path: '/tmp/child.jsonl' });
  const merged = dedupe([...parent.records, ...child.records]);
  assert.equal(merged.length, 1, '重放件必须折叠掉，否则整段父会话被重复计');
});

test('Codex：续读状态可以序列化并接着算', () => {
  const first = { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, total_tokens: 1100 };
  const second = { input_tokens: 2500, cached_input_tokens: 0, output_tokens: 250, total_tokens: 2750 };
  const a = runParser(codex, [
    { timestamp: '2026-07-18T16:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: first } } },
  ]);
  // 模拟增量尾读：状态过一遍 JSON，再继续喂后续行。
  const revived = JSON.parse(JSON.stringify(a.state));
  const fp = codex.createFileParser({ state: revived, candidate: { path: '/tmp/x.jsonl' } });
  fp.onObject({ timestamp: '2026-07-18T16:01:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: second } } });
  const b = fp.finish();
  assert.equal(b.records.length, 1);
  assert.equal(b.records[0].input, 1500, '基线跨续读保持，差值仍然正确');
});

test('Codex：lineFilter 不误命中工具输出里的 original_token_count', () => {
  assert.equal(codex.lineFilter('{"output":"original_token_count: 11"}'), false);
  assert.equal(codex.lineFilter('{"payload":{"info":{"total_token_usage":{}}}}'), true);
});

// ---------- Kimi Code ----------

test('Kimi：只收 usage.record，不收 step.end（否则整体翻倍）', () => {
  const usage = { inputOther: 6402, output: 275, inputCacheRead: 19200, inputCacheCreation: 0 };
  const stepEnd = { type: 'context.append_loop_event', event: { type: 'step.end', usage }, time: 1784087843782 };
  const usageRecord = { type: 'usage.record', model: 'kimi-code/kimi-for-coding', usage, usageScope: 'turn', time: 1784087843782 };
  const { records } = runParser(kimi, [stepEnd, usageRecord]);
  assert.equal(records.length, 1, 'step.end 携带同一组数字，必须忽略');
  assert.equal(records[0].input, 6402);
  assert.equal(records[0].cacheRead, 19200);
  assert.equal(records[0].model, 'kimi-code/kimi-for-coding');
});

test('Kimi：四个字段互不重叠，不做 inclusive 减法', () => {
  const { records } = runParser(kimi, [{
    type: 'usage.record',
    model: 'm',
    usage: { inputOther: 100, output: 50, inputCacheRead: 900, inputCacheCreation: 20 },
    time: 1784087843782,
  }]);
  const r = records[0];
  assert.equal(r.input, 100, 'inputOther 已经是非缓存部分');
  assert.equal(billable(r), 100 + 20 + 50);
  assert.equal(throughput(r), 100 + 20 + 50 + 900);
});

test('Kimi：同一条增量被写两次时折叠', () => {
  const rec = {
    type: 'usage.record', model: 'm', time: 1784087843782,
    usage: { inputOther: 100, output: 50, inputCacheRead: 0, inputCacheCreation: 0 },
  };
  const { records } = runParser(kimi, [rec, { ...rec }]);
  assert.equal(dedupe(records).length, 1);
});

// ---------- Qwen Code ----------

test('Qwen：input 含缓存（total == in + out）', () => {
  const { records } = runParser(qwen, [{
    id: 'q1',
    timestamp: '2026-07-19T13:53:54.605Z',
    model: 'qwen3.8-max-preview',
    inputTokens: 28299, outputTokens: 40, cachedTokens: 5000,
    thoughtsTokens: 26, totalTokens: 28339,
  }]);
  const r = records[0];
  assert.equal(r.input, 28299 - 5000);
  assert.equal(r.cacheRead, 5000);
  assert.equal(r.reasoning, 26);
  assert.ok(r.reasoning <= r.output || r.output === 40);
});

test('Qwen：subagent 标记为 sidechain', () => {
  const { records } = runParser(qwen, [{
    id: 'q2', timestamp: '2026-07-19T13:00:00Z', model: 'm', source: 'subagent',
    inputTokens: 10, outputTokens: 5, totalTokens: 15,
  }]);
  assert.equal(records[0].sidechain, true);
});

// ---------- Grok ----------

function grokTurn(usage, timestampSeconds = 1785391013) {
  return {
    timestamp: timestampSeconds,
    method: '_x.ai/session/update',
    params: {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'turn_completed', prompt_id: 'p1', usage },
    },
  };
}

test('Grok：epoch 秒归一到毫秒', () => {
  const { records } = runParser(grok, [grokTurn({
    inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedReadTokens: 0,
  })]);
  assert.equal(records[0].ts, 1785391013 * 1000);
});

test('Grok：input 含缓存，reasoning ⊂ output', () => {
  const { records } = runParser(grok, [grokTurn({
    inputTokens: 178992, outputTokens: 1879, totalTokens: 180871,
    cachedReadTokens: 117376, reasoningTokens: 543,
  })]);
  const r = records[0];
  assert.equal(r.input, 178992 - 117376);
  assert.equal(r.cacheRead, 117376);
  assert.equal(r.reasoning, 543);
  assert.equal(billable(r), (178992 - 117376) + 1879);
});

test('Grok：有 modelUsage 时按模型逐条产出', () => {
  const { records } = runParser(grok, [grokTurn({
    inputTokens: 300, outputTokens: 30, totalTokens: 330, cachedReadTokens: 0,
    modelUsage: {
      'grok-4.5-build': { inputTokens: 200, outputTokens: 20, totalTokens: 220, cachedReadTokens: 0 },
      'grok-4.5-mini': { inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedReadTokens: 0 },
    },
  })]);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.model).sort(), ['grok-4.5-build', 'grok-4.5-mini']);
  // 按模型拆开后不能互相吃掉：去重键里必须带模型名
  assert.equal(dedupe(records).length, 2);
});

test('Grok：没有 modelUsage 时退回合计，不丢数据', () => {
  const { records } = runParser(grok, [grokTurn({
    inputTokens: 300, outputTokens: 30, totalTokens: 330, cachedReadTokens: 0,
  })]);
  assert.equal(records.length, 1);
  assert.equal(records[0].input, 300);
});

test('Grok：非 turn_completed 的更新被忽略', () => {
  const { records } = runParser(grok, [{
    timestamp: 1785391013,
    params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk' } },
  }]);
  assert.equal(records.length, 0);
});
