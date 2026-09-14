import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as cline from '../src/runtime/parsers/cline.js';
import { scanAll } from '../src/runtime/scan.js';
import { throughput } from '../src/runtime/usage-record.js';
import { rmSync } from 'node:fs';

const time = Date.parse('2026-09-01T10:00:00Z');
const sum = result => result.records.reduce((n, r) => n + throughput(r), 0);
async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cline-'));
  const keys = ['MACLAWD_DATA_DIR', 'MACLAWD_CLINE_DIRS', 'MACLAWD_VSCODE_ROOTS'];
  const prior = keys.map(key => process.env[key]);
  process.env.MACLAWD_DATA_DIR = join(root, 'out');
  process.env.MACLAWD_CLINE_DIRS = root;
  process.env.MACLAWD_VSCODE_ROOTS = join(root, 'no-editor');
  const write = (path, value) => { const full = join(root, path); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, JSON.stringify(value)); return full; };
  const scan = () => scanAll({ parsers: [cline], ignoreSettings: true, budgetMs: 60000 });
  const sdk = (id, messages) => {
    write(`data/sessions/${id}/${id}.json`, { version: 1, session_id: id, cwd: '/fixture/original', model: 'fallback', started_at: new Date(time).toISOString() });
    return write(`data/sessions/${id}/${id}.messages.json`, { version: 1, sessionId: id, agent: 'lead', messages });
  };
  try { await run({ root, write, sdk, scan }); } finally {
    keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; });
    rmSync(root, { recursive: true, force: true });
  }
}

test('Cline SDK 官方 v1：仅统计带时间的 assistant metrics，输入含缓存读写', async () => fixture(async ({ root, sdk, scan }) => {
  sdk('s', [
    { id: 'partial', role: 'assistant', ts: time, modelInfo: { id: 'model-a' } },
    { id: 'final', role: 'assistant', ts: time, modelInfo: { id: 'model-a' }, content: [{ type: 'text', text: 'PRIVATE_BODY' }], metrics: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 } },
    { id: 'old-migration', role: 'assistant', metrics: { inputTokens: 99999 } },
    { id: 'user', role: 'user', ts: time, metrics: { inputTokens: 99999 } },
  ]);
  const result = await scan();
  assert.equal(sum(result), 150);
  assert.deepEqual(['input', 'cacheRead', 'write5m', 'output'].map(k => result.records[0][k]), [70, 20, 10, 50]);
  assert.equal(result.records[0].model, 'model-a');
  assert.equal(sum(await scan()), 150);
  assert.equal(readFileSync(join(root, 'out/usage/scan-cache.json'), 'utf8').includes('PRIVATE_BODY'), false);
}));

test('Cline SDK 副本/恢复保留同一次调用身份，补全快照替换部分值', async () => fixture(async ({ sdk, scan }) => {
  const message = { id: 'shared', role: 'assistant', ts: time, metrics: { inputTokens: 100, outputTokens: 1 } };
  sdk('original', [message]);
  sdk('restored', [{ ...message, metrics: { inputTokens: 100, outputTokens: 50 } }]);
  assert.equal(sum(await scan()), 150);
}));

test('Cline 旧版优先逐调用日期与模型，不把任务累计与明细重复相加', async () => fixture(async ({ write, scan }) => {
  write('state/taskHistory.json', [{ id: 'old', ts: time + 86400000, tokensIn: 300, tokensOut: 30, modelId: 'fallback', cwdOnTaskInitialization: '/fixture/legacy' }]);
  write('tasks/old/ui_messages.json', [
    { type: 'say', say: 'api_req_started', ts: time, text: JSON.stringify({ tokensIn: 100, tokensOut: 10, model: 'model-a' }) },
    { type: 'say', say: 'api_req_started', ts: time + 86400000, text: JSON.stringify({ tokensIn: 200, tokensOut: 20, model: 'model-b' }) },
  ]);
  const result = await scan();
  assert.equal(sum(result), 330);
  assert.deepEqual(result.records.map(r => [r.ts, r.model]), [[time, 'model-a'], [time + 86400000, 'model-b']]);
  assert.equal(result.records[0].project, 'legacy');
}));

test('Cline SDK 版本不支持/文件损坏保留旧值并报告不完整，manifest 变化使缓存失效', async () => fixture(async ({ sdk, write, scan }) => {
  const messages = [{ id: 'm', role: 'assistant', ts: time, metrics: { inputTokens: 10 } }];
  const path = sdk('s', messages);
  assert.equal(sum(await scan()), 10);
  write('data/sessions/s/s.json', { version: 1, session_id: 's', model: 'new-model', cwd: '/fixture/new-project' });
  assert.equal((await scan()).records[0].model, 'new-model');
  writeFileSync(path, '{"version":999,"messages":[]}');
  const broken = await scan();
  assert.equal(sum(broken), 10);
  assert.equal(broken.sourceStatus.cline.complete, false);
}));

test('Cline 嵌套 data 根不能把同一旧任务明细与汇总重复发现，明细缺失才回落', async () => fixture(async ({ write, scan }) => {
  write('data/state/taskHistory.json', [{ id: 'a', ts: time, tokensIn: 10 }, { id: 'b', ts: time, tokensIn: 20 }]);
  write('data/tasks/a/ui_messages.json', [{ type: 'say', say: 'api_req_started', ts: time, text: '{"tokensIn":10}' }]);
  const result = await scan();
  assert.equal(sum(result), 30);
  assert.equal(result.records.length, 2);
}));
