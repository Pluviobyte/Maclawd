import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexJsonlEvent, createCodexSessionMonitor } from '../src/runtime/codex-session-monitor.js';

test('Codex JSONL fallback maps only stable high-confidence lifecycle shapes', () => {
  assert.equal(codexJsonlEvent({ type: 'event_msg', payload: { type: 'task_started' } }, { sessionId: 's' }).type, 'UserPromptSubmit');
  assert.deepEqual(codexJsonlEvent({ type: 'response_item', payload: { type: 'local_shell_call' } }, { sessionId: 's' }), {
    sessionId: 's', agentId: 'codex', channel: 'jsonl', cwd: undefined,
    type: 'PreToolUse', toolName: 'Bash',
  });
  assert.equal(codexJsonlEvent({ type: 'event_msg', payload: { type: 'token_count' } }), null);
});

test('fallback learns session identity without replaying history and keeps partial lines', async () => {
  const home = mkdtempSync(join(tmpdir(), 'maclawd-codex-monitor-'));
  process.env.MACLAWD_CODEX_HOME = home;
  const dir = join(home, 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'rollout.jsonl');
  writeFileSync(path, `${JSON.stringify({ type: 'session_meta', payload: { id: 'real', cwd: '/tmp/project' } })}\n`);
  const events = [];
  const stop = createCodexSessionMonitor({ onEvent: (event) => events.push(event), intervalMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(events.length, 0, '历史 SessionStart 不应重放');
  const row = JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } });
  appendFileSync(path, row.slice(0, 20));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(events.length, 0, '半行不能被消费');
  appendFileSync(path, `${row.slice(20)}\n`);
  await new Promise((resolve) => setTimeout(resolve, 35));
  stop();
  assert.equal(events[0].sessionId, 'real');
  assert.equal(events[0].cwd, '/tmp/project');
  delete process.env.MACLAWD_CODEX_HOME;
});

test('GUI 写入完整事件后由文件变化立即触发，不等下一轮慢轮询', async () => {
  const home = mkdtempSync(join(tmpdir(), 'maclawd-codex-watch-'));
  process.env.MACLAWD_CODEX_HOME = home;
  const dir = join(home, 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'rollout.jsonl');
  writeFileSync(path, `${JSON.stringify({ type: 'session_meta', payload: { id: 'watched' } })}\n`);

  let stop = () => {};
  try {
    const event = new Promise((resolve) => {
      stop = createCodexSessionMonitor({ onEvent: resolve, intervalMs: 10_000 });
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    appendFileSync(path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`);
    const received = await Promise.race([
      event,
      new Promise((_, reject) => setTimeout(() => reject(new Error('文件变化未在 800ms 内触发')), 800)),
    ]);
    assert.equal(received.type, 'UserPromptSubmit');
    assert.equal(received.sessionId, 'watched');
  } finally {
    stop();
    delete process.env.MACLAWD_CODEX_HOME;
  }
});
