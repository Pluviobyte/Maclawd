import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Agent 连接可安装 Cursor 本地精确用量 hook，并由 Doctor 检查', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-integration-'));
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  process.env.MACLAWD_CURSOR_HOOKS_PATH = join(root, '.cursor', 'hooks.json');
  process.env.MACLAWD_CURSOR_LOG_DIR = join(root, 'cursor-logs');
  process.env.MACLAWD_VSCODE_ROOTS = join(root, 'Cursor');
  mkdirSync(join(root, 'Cursor'), { recursive: true });

  try {
    const action = await import(`../src/runtime/agent-integration-action.js?cursor=${Date.now()}`);
    const registry = await import(`../src/runtime/agent-registry.js?cursor=${Date.now()}`);
    assert.equal(action.supportsAgentIntegration('cursor'), true);

    action.changeAgentIntegration('cursor', 'install');
    const config = JSON.parse(readFileSync(process.env.MACLAWD_CURSOR_HOOKS_PATH, 'utf8'));
    assert.match(config.hooks.stop[0].command, /maclawd-cursor-hook\.js/);
    const connected = registry.agentConnections().find((agent) => agent.id === 'cursor');
    assert.equal(connected.capabilities.localCapture, true);
    assert.equal(connected.integration.status, 'connected');
    const check = registry.runAgentDoctor({ cursorHookEnhancement: true })
      .checks.find((item) => item.agentId === 'cursor');
    assert.equal(check.level, 'ok');

    action.changeAgentIntegration('cursor', 'uninstall');
    assert.equal(registry.agentConnections().find((agent) => agent.id === 'cursor')
      .integration.status, 'available');
  } finally {
    delete process.env.MACLAWD_DATA_DIR;
    delete process.env.MACLAWD_CURSOR_HOOKS_PATH;
    delete process.env.MACLAWD_CURSOR_LOG_DIR;
    delete process.env.MACLAWD_VSCODE_ROOTS;
    rmSync(root, { recursive: true, force: true });
  }
});
