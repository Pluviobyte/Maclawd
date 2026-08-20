import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maclawd-cursor-hook-install-'));
const hooksPath = join(root, 'hooks.json');
process.env.MACLAWD_CURSOR_HOOKS_PATH = hooksPath;

const {
  cursorHookStatus, installCursorHook, uninstallCursorHook,
} = await import(`../src/runtime/cursor-hook-install.js?test=${Date.now()}`);

test.after(() => {
  delete process.env.MACLAWD_CURSOR_HOOKS_PATH;
  rmSync(root, { recursive: true, force: true });
});

test('Cursor stop hook 安全合并、幂等更新，并只卸载 Maclawd 条目', () => {
  writeFileSync(hooksPath, JSON.stringify({
    version: 1,
    custom: { keep: true },
    hooks: {
      stop: [{ command: './hooks/other-tool.sh', loop_limit: 3 }],
      sessionStart: [{ command: './hooks/session.sh' }],
    },
  }, null, 2));

  const first = installCursorHook({ nodePath: '/opt/node-a' });
  assert.equal(first.installed, true);
  let config = JSON.parse(readFileSync(hooksPath, 'utf8'));
  assert.deepEqual(config.custom, { keep: true });
  assert.equal(config.hooks.stop.length, 2);
  assert.equal(config.hooks.stop[0].command, './hooks/other-tool.sh');
  assert.match(config.hooks.stop[1].command, /maclawd-cursor-hook\.js/);
  assert.match(config.hooks.stop[1].command, /opt\/node-a/);
  assert.equal(config.hooks.sessionStart[0].command, './hooks/session.sh');

  const second = installCursorHook({ nodePath: '/opt/node-b' });
  assert.equal(second.alreadyInstalled, true);
  config = JSON.parse(readFileSync(hooksPath, 'utf8'));
  assert.equal(config.hooks.stop.length, 2, '重复安装不能追加第二条 Maclawd hook');
  assert.match(config.hooks.stop[1].command, /opt\/node-b/,
    '重装必须刷新打包后变化的 node 与脚本绝对路径');
  assert.deepEqual(cursorHookStatus().installed, ['stop']);

  const removed = uninstallCursorHook();
  assert.equal(removed.removed, true);
  config = JSON.parse(readFileSync(hooksPath, 'utf8'));
  assert.equal(config.hooks.stop.length, 1);
  assert.equal(config.hooks.stop[0].command, './hooks/other-tool.sh');
  assert.equal(config.hooks.sessionStart[0].command, './hooks/session.sh');
  assert.deepEqual(config.custom, { keep: true });
});
