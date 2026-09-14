import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pi from '../src/runtime/parsers/pi-coding-agent.js';
import * as omp from '../src/runtime/parsers/omp.js';
import { listJsonl } from '../src/runtime/scan.js';

test('Pi agent 根追加 sessions，独立 sessionDir 保持原路径；OMP 不重复计入 Pi', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-pi-roots-'));
  const keys = ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'MACLAWD_PI_DIR', 'MACLAWD_OMP_DIR'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    const agent = join(root, 'agent'), extra = join(root, 'custom');
    mkdirSync(join(agent, 'sessions'), { recursive: true }); mkdirSync(extra);
    writeFileSync(join(agent, 'sessions', 'a.jsonl'), '{}\n');
    writeFileSync(join(extra, 'b.jsonl'), '{}\n');
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ sessionDir: extra }));
    process.env.PI_CODING_AGENT_DIR = agent;
    process.env.PI_CODING_AGENT_SESSION_DIR = extra;
    assert.deepEqual(pi.dataDirs().sort(), [join(agent, 'sessions'), extra].map(path => realpathSync(path)).sort());
    assert.equal(pi.discover({ listJsonl }).length, 2);
    writeFileSync(join(agent, 'config.yml'), 'test: true');
    assert.equal(pi.discover({ listJsonl }).length, 0, 'OMP store 不归入 Pi');
    assert.ok(omp.dataDirs().includes(realpathSync(join(agent, 'sessions'))), 'OMP 继承的 agent 根要被 OMP 识别');
  } finally {
    for (const k of keys) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; }
    rmSync(root, { recursive: true, force: true });
  }
});
