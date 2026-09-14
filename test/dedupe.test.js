import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/runtime/dedupe.js';
import { throughput } from '../src/runtime/usage-record.js';

function record(overrides = {}) {
  return {
    source: 'generic',
    input: 100, output: 10, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0,
    model: 'test', ts: 1_700_000_000_000,
    messageId: null, requestId: null, uuid: null, sidechain: false,
    ...overrides,
  };
}

const sum = (records) => records.reduce((n, r) => n + throughput(r), 0);

test('同 message.id + 同 requestId 视为同一条', () => {
  const out = dedupe([
    record({ messageId: 'm1', requestId: 'r1' }),
    record({ messageId: 'm1', requestId: 'r1' }),
  ]);
  assert.equal(out.length, 1);
});

test('Claude Code：内容块与流式记录按调用去重，保留完整用量', () => {
  const out = dedupe([
    record({ source: 'claude-code', messageId: 'm1', requestId: 'r1', uuid: 'u1', input: 100 }),
    record({ source: 'claude-code', messageId: 'm1', requestId: 'r1', uuid: 'u2', input: 200 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(sum(out), 210);
});

test('Claude Code：相同 UUID 的复制记录只保留最完整的一条', () => {
  const out = dedupe([
    record({ source: 'claude-code', uuid: 'u1', input: 100 }),
    record({ source: 'claude-code', uuid: 'u1', input: 500 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].input, 500);
});

test('Claude Code：缺失单个调用 ID 仍去重；无身份记录保留', () => {
  for (const identity of [{ messageId: 'm' }, { requestId: 'r' }]) {
    assert.equal(dedupe(['a', 'b'].map(uuid => record({ source: 'claude-code', ...identity, uuid }))).length, 1);
  }
  assert.equal(dedupe([record({ source: 'claude-code' }), record({ source: 'claude-code' })]).length, 2);
});

test('Claude Code：不同请求不能因 sidechain 或相同 UUID 而合并', () => {
  assert.equal(dedupe([
    record({ source: 'claude-code', messageId: 'm', requestId: 'r1', uuid: 'u' }),
    record({ source: 'claude-code', messageId: 'm', requestId: 'r2', uuid: 'u', sidechain: true }),
  ]).length, 2);
});

test('Claude Code：完整 sidechain 副本优先于不完整主记录，与顺序无关', () => {
  const partial = record({ source: 'claude-code', messageId: 'm', uuid: 'a', output: 1 });
  const final = record({ ...partial, uuid: 'b', output: 100, sidechain: true });
  for (const rows of [[partial, final], [final, partial]]) {
    assert.equal(dedupe(rows).length, 1);
    assert.equal(dedupe(rows)[0].output, 100);
  }
});

test('同 message.id、不同 requestId 是合法分片，默认不合并', () => {
  // API 流式重试会复用 message.id 但换 requestId；两条都是真实用量时不能丢。
  const out = dedupe([
    record({ messageId: 'm1', requestId: 'r1' }),
    record({ messageId: 'm1', requestId: 'r2' }),
  ]);
  assert.equal(out.length, 2);
});

test('同 message.id、不同 requestId，任一方是 sidechain 时合并', () => {
  const out = dedupe([
    record({ messageId: 'm1', requestId: 'r1' }),
    record({ messageId: 'm1', requestId: 'r2', sidechain: true }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sidechain, false, '非 sidechain 优先');
});

test('冲突时保留 throughput 更大的那条', () => {
  // Claude 会把同一条记录以零用量复制到别处
  const out = dedupe([
    record({ messageId: 'm1', requestId: 'r1', input: 0, output: 0 }),
    record({ messageId: 'm1', requestId: 'r1', input: 5000, output: 300 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].input, 5000);
});

test('缺少 message.id 时回落 uuid 次键', () => {
  const out = dedupe([
    record({ uuid: 'u1' }),
    record({ uuid: 'u1' }),
    record({ uuid: 'u2' }),
  ]);
  assert.equal(out.length, 2);
});

test('两个键都缺失时不去重，避免误删', () => {
  const out = dedupe([record(), record(), record()]);
  assert.equal(out.length, 3);
});

test('不同 source 的 id 空间互不干扰', () => {
  const out = dedupe([
    record({ source: 'claude-code', messageId: 'shared' }),
    record({ source: 'workbuddy', messageId: 'shared' }),
  ]);
  assert.equal(out.length, 2);
});

test('结果与输入顺序无关', () => {
  const a = record({ messageId: 'm1', requestId: 'r1', input: 10 });
  const b = record({ messageId: 'm1', requestId: 'r1', input: 900 });
  assert.equal(sum(dedupe([a, b])), sum(dedupe([b, a])));
});

test('WorkBuddy 场景：顶层 id 相同但 messageId 不同的两次调用都要保留', () => {
  // 实测 ~/.workbuddy 里两条 function_call 共用 id "gen-…"，只有 messageId 不同。
  // 按 id 去重会少算一次完整的模型调用。
  const out = dedupe([
    record({ source: 'workbuddy', messageId: '118dbbbbe5de', input: 30187, output: 138 }),
    record({ source: 'workbuddy', messageId: 'd4f7f4bebcd2', input: 5060, output: 1990 }),
  ]);
  assert.equal(out.length, 2);
});
