import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as parser from '../src/runtime/parsers/antigravity.js';
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));

function varint(n) { const b = []; do { let x = n % 128; n = Math.floor(n / 128); b.push(x + (n ? 128 : 0)); } while (n); return b; }
const v = (k, n) => [...varint(k * 8), ...varint(n)];
const blob = (k, bytes) => [...varint(k * 8 + 2), ...varint(bytes.length), ...bytes];
const str = (k, s) => blob(k, [...Buffer.from(s)]);

test('Antigravity 新版按 bot/step 身份恢复时间，输出含推理不能再加一次', { skip: !DatabaseSync }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-agy-'));
  const path = join(root, 'conversation.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB); CREATE TABLE steps(idx INTEGER, metadata BLOB)');
    const usage = [...v(2, 1000), ...v(3, 250), ...v(4, 30), ...v(5, 5000), ...v(9, 50), ...v(10, 200), ...str(7, 'bot'), ...str(11, 'response')];
    const generation = blob(1, [...blob(4, usage), ...str(19, 'model')]);
    db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(1, Buffer.from([...generation, ...str(4, 'step')]));
    const meta = bot => Buffer.from([...blob(1, v(1, 1700000000)), ...blob(9, str(7, bot)), ...str(12, 'step')]);
    // generation.idx 和 steps.idx 并非可靠关联；故意让同索引指向另一条步骤。
    db.prepare('INSERT INTO steps VALUES(?,?)').run(1, meta('wrong-bot'));
    db.prepare('INSERT INTO steps VALUES(?,?)').run(7, meta('bot'));
    const result = await parser.createFileParser({ candidate: { path } }).finish();
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].ts, 1700000000000);
    assert.equal(result.records[0].output, 250);
    assert.equal(result.records[0].reasoning, 50);
    assert.equal(result.records[0].write5m, 30);
    db.prepare('INSERT INTO steps VALUES(?,?)').run(8, meta('bot'));
    await assert.rejects(async () => parser.createFileParser({ candidate: { path } }).finish(), /唯一关联/);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
