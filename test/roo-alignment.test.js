import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as roo from '../src/runtime/parsers/roo-code.js';
import { scanAll } from '../src/runtime/scan.js';
import { throughput } from '../src/runtime/usage-record.js';

test('Roo _index.entries 发现逐调用，去除任务摘要叠加并且不把 profile 名当模型', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-roo-'));
  const prior = [process.env.MACLAWD_DATA_DIR, process.env.MACLAWD_VSCODE_ROOTS];
  process.env.MACLAWD_DATA_DIR = join(root, 'out');
  process.env.MACLAWD_VSCODE_ROOTS = root;
  const tasks = join(root, 'User/globalStorage/rooveterinaryinc.roo-cline/tasks');
  mkdirSync(join(tasks, 'task'), { recursive: true });
  const ts = Date.parse('2026-09-01T10:00:00Z');
  const history = { id: 'task', ts: ts + 86400000, tokensIn: 300, tokensOut: 30, workspace: '/fixture/project', apiConfigName: 'my-budget-profile' };
  const scan = () => scanAll({ parsers: [roo], ignoreSettings: true });
  try {
    writeFileSync(join(tasks, '_index.json'), JSON.stringify({ version: 1, entries: [history] }));
    writeFileSync(join(tasks, 'task/history_item.json'), JSON.stringify(history));
    writeFileSync(join(tasks, 'task/ui_messages.json'), JSON.stringify([
      { type: 'say', say: 'api_req_started', ts, text: '{"tokensIn":100,"tokensOut":10,"model":"model-a"}' },
      { type: 'say', say: 'api_req_started', ts: ts + 86400000, text: '{"tokensIn":200,"tokensOut":20}' },
    ]));
    let result = await scan();
    assert.equal(result.records.length, 2);
    assert.equal(result.records.reduce((n, r) => n + throughput(r), 0), 330);
    assert.deepEqual(result.records.map(r => [r.ts, r.model]), [[ts, 'model-a'], [ts + 86400000, 'unknown']]);
    assert.equal(result.records[0].project, 'project');
    assert.equal((await scan()).records.length, 2);
    writeFileSync(join(tasks, 'task/ui_messages.json'), '{"incomplete":');
    result = await scan();
    assert.equal(result.sourceStatus['roo-code'].complete, false);
    assert.equal(result.records.length, 2);
    rmSync(join(tasks, 'task/ui_messages.json'));
    result = await scan();
    assert.equal(result.records.length, 1, '无明细时只保留一份摘要');
    assert.equal(result.records.reduce((n, r) => n + throughput(r), 0), 330);
  } finally {
    ['MACLAWD_DATA_DIR', 'MACLAWD_VSCODE_ROOTS'].forEach((key, i) => {
      if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i];
    });
    rmSync(root, { recursive: true, force: true });
  }
});
