import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as codex from '../src/runtime/parsers/codex.js';
import { scanAll } from '../src/runtime/scan.js';
import { throughput } from '../src/runtime/usage-record.js';

const ts = n => new Date(Date.UTC(2026, 8, 1) + n * 1000).toISOString();
const meta = (id, n = 0, extra = {}) => ({ type: 'session_meta', timestamp: ts(n), payload: { id, timestamp: ts(n), cwd: '/fixture/project', ...extra } });
const token = (n, total, last = undefined) => ({ type: 'event_msg', timestamp: ts(n), payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: total, total_tokens: total },
  ...(last === undefined ? {} : { last_token_usage: { input_tokens: last } }),
} } });
const task = n => ({ type: 'event_msg', timestamp: ts(n), payload: { type: 'task_started', started_at: Date.parse(ts(n)) / 1000 } });
const context = (n, model) => ({ type: 'turn_context', timestamp: ts(n), payload: { model } });
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const total = result => result.records.reduce((sum, row) => sum + throughput(row), 0);

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-codex-reconcile-'));
  const previous = { MACLAWD_DATA_DIR: process.env.MACLAWD_DATA_DIR, MACLAWD_CODEX_HOME: process.env.MACLAWD_CODEX_HOME };
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  process.env.MACLAWD_CODEX_HOME = root;
  mkdirSync(join(root, 'sessions'));
  mkdirSync(join(root, 'archived_sessions'));
  const write = (name, rows) => { const path = join(root, name); writeFileSync(path, lines(rows)); return path; };
  const scan = extra => scanAll({ parsers: [codex], ignoreSettings: true, budgetMs: 60000, ...extra });
  try { await run({ root, write, scan }); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test('Codex 相同数值的独立会话不能相互去重，缺 task 的旧子会话不能全部丢弃', async () => fixture(async ({ write, scan }) => {
  write('sessions/a.jsonl', [meta('a'), token(1, 10, 10)]);
  write('sessions/b.jsonl', [meta('b'), token(2, 10, 10)]);
  write('sessions/c.jsonl', [meta('c', 3, { parent_thread_id: 'a' }), token(4, 7, 7)]);
  assert.equal(total(await scan()), 27);
  assert.equal(total(await scan()), 27, '暖缓存不能重新应用全局快照去重');
}));

test('Codex 仅删除父会话在 spawn 时的已证实重放前缀，保留后续相同 payload 调用', async () => fixture(async ({ write, scan }) => {
  const parent = write('sessions/parent.jsonl', [meta('parent'), token(1, 10, 10), token(2, 20, 10)]);
  write('sessions/child.jsonl', [meta('child', 3, { forked_from_id: 'parent' }), token(3, 10, 10), token(3, 20, 10), token(4, 5, 5), token(5, 10, 10)]);
  const first = await scan();
  assert.equal(total(first), 35);
  assert.equal(first.records.filter(row => row.ts === Date.parse(ts(3))).length, 0);
  appendFileSync(parent, lines([token(6, 30, 10)]));
  assert.equal(total(await scan()), 45, '父会话后续增长不能改变旧分叉边界');
}));

test('Codex 子会话只复制部分父历史时无临时峰值，边界出现后仅计新增', async () => fixture(async ({ write, scan }) => {
  write('sessions/parent.jsonl', [meta('parent'), token(1, 10, 10), token(2, 20, 10), token(3, 30, 10)]);
  const child = write('sessions/child.jsonl', [meta('child', 4, { source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }), token(4, 10, 10), token(4, 20, 10)]);
  assert.equal(total(await scan()), 30);
  appendFileSync(child, lines([token(4, 30, 10), task(4), token(5, 37, 7)]));
  const appended = await scan();
  assert.equal(appended.stats.appended, 1);
  assert.equal(total(appended), 37);
}));

test('Codex 同 ID 分段先合并再做累计差，跨文件副本、计数重置与模型上下文保持一致', async () => fixture(async ({ root, write, scan }) => {
  const head = meta('logical');
  const t10 = token(1, 10), t20 = token(2, 20), t30 = token(3, 30);
  write('archived_sessions/first.jsonl', [head, context(0, 'model-a'), t10, t20]);
  const continuation = [head, context(0, 'model-b'), t20, t30, token(4, 5), token(5, 8)];
  const path = write('sessions/second.jsonl', continuation);
  write('sessions/copy.jsonl', continuation);
  const result = await scan();
  assert.equal(total(result), 38);
  assert.equal(result.records.find(row => row.ts === Date.parse(ts(3))).model, 'model-b');
  assert.equal(result.sessionsBySource.codex.length, 1);
  assert.equal(total(await scan()), 38);
  rmSync(join(root, 'sessions/copy.jsonl'));
  appendFileSync(path, lines([token(6, 11)]));
  assert.equal(total(await scan()), 41);
}));

test('Codex 分段顺序冲突时标记不完整并保留最后成功值，不静默重复相加', async () => fixture(async ({ write, scan }) => {
  const head = meta('same'), a = token(1, 10), b = token(2, 20);
  write('sessions/one.jsonl', [head, a, b]);
  assert.equal(total(await scan()), 20);
  const path = write('sessions/two.jsonl', [head, b, a]);
  const failed = await scan();
  assert.equal(total(failed), 20);
  assert.equal(failed.sourceStatus.codex.complete, false);
  assert.match(failed.warnings[0], /顺序冲突/);
  rmSync(path);
  assert.equal((await scan()).sourceStatus.codex.complete, true);
}));

test('Codex 同文件名的 disjoint continuation 都保留，分块扫描与冷暖扫描相同', async () => fixture(async ({ write, scan }) => {
  write('sessions/same.jsonl', [meta('same'), token(1, 10), token(2, 20)]);
  write('archived_sessions/same.jsonl', [meta('same'), token(3, 30), token(4, 40)]);
  let result;
  for (let i = 0; i < 20; i++) {
    result = await scan({ maxFileBytes: 200 });
    if (result.sourceStatus.codex.complete) break;
  }
  assert.equal(result.sourceStatus.codex.complete, true);
  assert.equal(total(result), 40);
  assert.equal(total(await scan()), 40);
}));

test('Codex last-only 和缓存写入按官方字段拆分，缓存不保留工具或用户正文', async () => fixture(async ({ root, write, scan }) => {
  const row = token(1, 0);
  delete row.payload.info.total_token_usage;
  row.payload.info.last_token_usage = { input_tokens: 100, cached_input_tokens: 20,
    cache_write_input_tokens: 10, output_tokens: 50, reasoning_output_tokens: 15 };
  write('sessions/one.jsonl', [meta('one'), { type: 'response_item', timestamp: ts(0),
    payload: { content: 'DO_NOT_CACHE_PRIVATE_TEXT' } }, row]);
  const result = await scan();
  assert.equal(total(result), 150);
  assert.deepEqual(['input', 'cacheRead', 'write5m', 'output', 'reasoning'].map(k => result.records[0][k]), [70, 20, 10, 50, 15]);
  assert.equal(readFileSync(join(root, 'data/usage/scan-cache.json'), 'utf8').includes('DO_NOT_CACHE_PRIVATE_TEXT'), false);
}));

test('Codex service tier survives cold/warm/append scans and snapshot serialization', async () => fixture(async ({write,scan})=>{
 const ctx=(tier)=>({...context(0,'gpt-6-astra'),payload:{model:'gpt-6-astra',service_tier:tier}});
 const path=write('sessions/tier.jsonl',[meta('tier'),ctx('priority'),token(1,100,100)]);
 for(let i=0;i<2;i++) {
  const r=(await scan()).records[0];assert.deepEqual(r.billing,{serviceTier:'fast',promptTokens:100});
 }
 appendFileSync(path,lines([{type:'event_msg',timestamp:ts(2),payload:{type:'thread_settings_applied',thread_settings:{service_tier:'flex'}}},token(3,200,100)]));
 const result=await scan();assert.equal(result.stats.appended,1);assert.deepEqual(result.records.map(r=>r.billing.serviceTier),['fast','flex']);assert.equal(total(result),200);
}));
