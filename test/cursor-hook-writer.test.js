import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, readFileSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('hooks/maclawd-cursor-hook.js');

test('Cursor stop hook 只把精确用量白名单写入 Maclawd 本地 JSONL', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-hook-writer-'));
  const payload = {
    hook_event_name: 'stop',
    generation_id: 'generation-precise-1',
    model: 'claude-opus-4-8',
    input_tokens: 106447,
    output_tokens: 2593,
    cache_read_tokens: 52462,
    cache_write_tokens: 53981,
    user_email: 'private@example.com',
    workspace_roots: ['/private/project'],
    transcript_path: '/private/transcript.jsonl',
    prompt: 'must never be persisted',
  };

  try {
    execFileSync(process.execPath, [script], {
      input: JSON.stringify(payload),
      env: { ...process.env, MACLAWD_DATA_DIR: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const dir = join(root, 'usage', 'cursor-hooks');
    const files = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const line = readFileSync(join(dir, files[0]), 'utf8').trim();
    assert.deepEqual(JSON.parse(line), {
      source: 'cursor',
      generationId: 'generation-precise-1',
      model: 'claude-opus-4-8',
      inputTokens: 106447,
      outputTokens: 2593,
      cacheReadTokens: 52462,
      cacheWriteTokens: 53981,
      ts: JSON.parse(line).ts,
    });
    assert.ok(Number.isFinite(JSON.parse(line).ts));
    assert.doesNotMatch(line, /private@example|private\/project|transcript|prompt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
