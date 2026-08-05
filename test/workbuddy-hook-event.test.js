import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('WorkBuddy Hook 上报标准事件且不泄露命令原文', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maclawd-workbuddy-event-'));
  let received;
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL('../hooks/maclawd-hook.js', import.meta.url)),
      'PreToolUse',
      '--maclawd-source=workbuddy',
    ], {
      env: {
        ...process.env,
        MACLAWD_PORT: String(server.address().port),
        MACLAWD_DATA_DIR: dataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stdin.end(JSON.stringify({
      session_id: 'wb-session',
      cwd: '/tmp/project',
      tool_name: 'Bash',
      tool_input: { command: 'npm run build -- --secret=never-send-this' },
    }));
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    assert.equal(exitCode, 0);
    assert.equal(stdout.trim(), '{}', 'WorkBuddy 命令 Hook 必须收到合法的空决策 JSON');
    assert.equal(received.agentId, 'workbuddy');
    assert.equal(received.channel, 'hook');
    assert.equal(received.type, 'PreToolUse');
    assert.equal(received.sessionId, 'wb-session');
    assert.equal(received.toolName, 'Bash');
    assert.equal(received.commandClass, 'working.building');
    assert.equal(JSON.stringify(received).includes('never-send-this'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('WorkBuddy Hook 缺少 session_id 时不创建幽灵会话', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maclawd-workbuddy-no-session-'));
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL('../hooks/maclawd-hook.js', import.meta.url)),
      'UserPromptSubmit',
      '--maclawd-source=workbuddy',
    ], {
      env: {
        ...process.env,
        MACLAWD_PORT: String(server.address().port),
        MACLAWD_DATA_DIR: dataDir,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit' }));
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(stdout.trim(), '{}');
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
