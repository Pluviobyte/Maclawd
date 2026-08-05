import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Codex hooks merge safely and uninstall only Maclawd entries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-codex-hooks-'));
  const path = join(dir, 'hooks.json');
  process.env.MACLAWD_CODEX_HOOKS_PATH = path;
  writeFileSync(path, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } }));
  const mod = await import(`../src/runtime/codex-hook-install.js?test=${Date.now()}`);
  const result = mod.installCodexHooks({ nodePath: '/usr/bin/node' });
  assert.equal(result.changed.length, mod.CODEX_HOOK_EVENTS.length);
  const installed = JSON.parse(readFileSync(path));
  assert.equal(installed.hooks.Stop[0].hooks[0].command, 'other-tool');
  assert.match(installed.hooks.Stop[1].hooks[0].command, /maclawd-codex-hook\.js/);
  assert.equal(installed.hooks.Stop[1].hooks[0].async, undefined);
  mod.installCodexPermissionHook({ nodePath: '/usr/bin/node' });
  assert.equal(mod.codexHookStatus().permissionInstalled, true);
  mod.uninstallCodexHooks();
  const cleaned = JSON.parse(readFileSync(path));
  assert.equal(cleaned.hooks.Stop[0].hooks[0].command, 'other-tool');
  delete process.env.MACLAWD_CODEX_HOOKS_PATH;
});
