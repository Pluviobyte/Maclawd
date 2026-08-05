import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maclawd-workbuddy-hooks-'));
const settingsPath = join(root, 'settings.json');
process.env.MACLAWD_WORKBUDDY_SETTINGS = settingsPath;

const {
  WORKBUDDY_HOOK_EVENTS,
  installWorkBuddyHooks,
  uninstallWorkBuddyHooks,
  workBuddySettingsPath,
  workBuddyHookStatus,
} = await import('../src/runtime/workbuddy-hook-install.js');

const read = () => JSON.parse(readFileSync(settingsPath, 'utf8'));
const write = (value) => writeFileSync(settingsPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

beforeEach(() => {
  rmSync(settingsPath, { force: true });
  rmSync(`${settingsPath}.maclawd-backup`, { force: true });
});

after(() => {
  delete process.env.MACLAWD_WORKBUDDY_SETTINGS;
  rmSync(root, { recursive: true, force: true });
});

test('WorkBuddy 事件增强合并配置且不接管权限', () => {
  write({ theme: 'dark', hooks: {
    Stop: [{ hooks: [{ type: 'command', command: '/usr/bin/say done' }] }],
  } });

  const result = installWorkBuddyHooks({ nodePath: '/usr/bin/node' });
  assert.deepEqual(result.installed.sort(), [...WORKBUDDY_HOOK_EVENTS].sort());
  const settings = read();
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, '/usr/bin/say done');
  assert.ok(!Object.hasOwn(settings.hooks, 'PermissionRequest'));

  for (const event of WORKBUDDY_HOOK_EVENTS) {
    const ours = settings.hooks[event].flatMap((group) => group.hooks ?? [])
      .find((hook) => hook.command?.includes('maclawd-hook.js'));
    assert.ok(ours, `${event} 未安装`);
    assert.match(ours.command, new RegExp(` ${event} --maclawd-source=workbuddy$`));
    assert.equal(ours.type, 'command');
    assert.equal(ours.async, undefined, 'WorkBuddy 尚未证明支持 Claude Code 的 async 扩展字段');
  }
  assert.equal(existsSync(`${settingsPath}.maclawd-backup`), true);
});

test('WorkBuddy 重复安装幂等，卸载只移除 Maclawd 条目', () => {
  write({ hooks: {
    Stop: [{ hooks: [{ type: 'command', command: '/other/workbuddy-hook.js' }] }],
  } });
  installWorkBuddyHooks({ nodePath: '/old/node' });
  const again = installWorkBuddyHooks({ nodePath: '/new/node' });
  assert.equal(again.installed.length, 0);
  assert.equal(again.alreadyInstalled.length, WORKBUDDY_HOOK_EVENTS.length);

  const refreshed = read().hooks.Stop.flatMap((group) => group.hooks ?? [])
    .find((hook) => hook.command?.includes('maclawd-hook.js'));
  assert.match(refreshed.command, /^"\/new\/node" /);

  const removed = uninstallWorkBuddyHooks();
  assert.deepEqual(removed.removed.sort(), [...WORKBUDDY_HOOK_EVENTS].sort());
  assert.deepEqual(read().hooks.Stop[0].hooks, [
    { type: 'command', command: '/other/workbuddy-hook.js' },
  ]);
  assert.equal(workBuddyHookStatus().installed.length, 0);
});

test('WorkBuddy 配置损坏时拒绝覆盖', () => {
  writeFileSync(settingsPath, '{ invalid', 'utf8');
  assert.throws(() => installWorkBuddyHooks(), /无法解析/);
  assert.equal(readFileSync(settingsPath, 'utf8'), '{ invalid');
});

test('重复安装不会覆盖第一次修改前的备份', () => {
  write({ theme: 'original' });
  installWorkBuddyHooks();
  const backup = `${settingsPath}.maclawd-backup`;
  assert.equal(JSON.parse(readFileSync(backup, 'utf8')).theme, 'original');

  const changed = read();
  changed.theme = 'later';
  write(changed);
  installWorkBuddyHooks();
  assert.equal(JSON.parse(readFileSync(backup, 'utf8')).theme, 'original');
});

test('安装后保持原配置权限，新配置默认仅当前用户可读写', () => {
  write({ theme: 'private' });
  chmodSync(settingsPath, 0o600);
  installWorkBuddyHooks();
  assert.equal(statSync(settingsPath).mode & 0o777, 0o600);

  rmSync(settingsPath, { force: true });
  installWorkBuddyHooks();
  assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
});

test('配置路径优先当前目录，并兼容已有 5.3.x 旧目录', () => {
  const home = join(root, 'home');
  const current = join(home, '.workbuddy-ai', 'settings.json');
  const legacy = join(home, '.workbuddy', 'settings.json');
  assert.equal(workBuddySettingsPath({ home, env: {}, exists: (path) => path === current }), current);
  assert.equal(workBuddySettingsPath({ home, env: {}, exists: (path) => path === legacy }), legacy);
  assert.equal(workBuddySettingsPath({
    home,
    env: {},
    exists: (path) => path === join(home, '.workbuddy', 'projects'),
  }), legacy);
  assert.equal(workBuddySettingsPath({ home, env: {}, exists: () => false }), current);
});
