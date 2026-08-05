import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTailer } from '../src/runtime/tail.js';

test('实时速率保留来源，Codex GUI 状态可与五分钟强度信号分离', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-tail-source-'));
  const path = join(dir, 'usage.jsonl');
  writeFileSync(path, '');
  const parser = {
    discover: () => {
      const stat = statSync(path);
      return [{ path, size: stat.size, ino: stat.ino }];
    },
    createFileParser: () => {
      const records = [];
      return {
        onObject: (row) => records.push({
          source: row.source, ts: row.ts,
          input: row.tokens, output: 0, cacheRead: 0, write5m: 0, write1h: 0,
        }),
        finish: () => ({ records }),
      };
    },
  };
  const tailer = createTailer({ parsers: [parser], windowMs: 60_000, persist: false });

  try {
    const now = Date.now();
    await tailer.poll({ now, ignoreSettings: true });
    appendFileSync(path, `${JSON.stringify({ source: 'codex', tokens: 600, ts: now })}\n`);
    appendFileSync(path, `${JSON.stringify({ source: 'claude-code', tokens: 300, ts: now })}\n`);
    const live = await tailer.poll({ now, ignoreSettings: true });
    assert.equal(live.tokensPerMin, 900);
    assert.deepEqual(live.tokensPerMinBySource, { codex: 600, 'claude-code': 300 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
