import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 这是本项目唯一会写「不属于自己」的文件的地方，所以测试重点全在**不越界**：
 * 卸载必须只移除自己的条目，用户和别的工具的 hook 一个都不能碰。
 */

const root = mkdtempSync(join(tmpdir(), 'maclawd-hooks-'));
const SETTINGS = join(root, 'settings.json');
process.env.MACLAWD_CLAUDE_SETTINGS = SETTINGS;

const {
  installHooks, uninstallHooks, hookStatus, hookScriptPath, HOOK_EVENTS,
} = await import('../src/runtime/hook-install.js');

after(() => rmSync(root, { recursive: true, force: true }));

const read = () => JSON.parse(readFileSync(SETTINGS, 'utf-8'));
const write = (value) => writeFileSync(SETTINGS, JSON.stringify(value, null, 2), 'utf-8');

beforeEach(() => {
  rmSync(SETTINGS, { force: true });
  rmSync(`${SETTINGS}.maclawd-backup`, { force: true });
});

// ---------- 安装 ----------

test('从零安装：订阅全部状态事件', () => {
  const result = installHooks({ nodePath: '/usr/bin/node' });
  assert.deepEqual(result.installed.sort(), [...HOOK_EVENTS].sort());
  const settings = read();
  for (const event of HOOK_EVENTS) {
    assert.ok(Array.isArray(settings.hooks[event]), `${event} 未写入`);
  }
});

test('必须以 async 注册——否则「不拖慢 agent」只是承诺不是保证', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  const entry = read().hooks.PreToolUse[0].hooks[0];
  assert.equal(entry.async, true);
  assert.equal(entry.type, 'command');
  assert.ok(Number.isFinite(entry.timeout));
});

test('只注册状态事件，不注册任何会拦截权限的 hook', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  const events = Object.keys(read().hooks);
  // 权限决策必须完全留在 Claude Code 自己的流程里
  assert.ok(!events.includes('PermissionRequest'), '不应订阅 PermissionRequest');
  assert.ok(!events.includes('PermissionDecision'));
  // 且没有任何 http 类型的 hook（那才是能返回决策的形态）
  const all = Object.values(read().hooks).flat()
    .flatMap((g) => g.hooks ?? []);
  assert.ok(all.every((h) => h.type === 'command'), '不应出现 http hook');
});

test('命令里带事件名与脚本绝对路径', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  const command = read().hooks.Stop[0].hooks[0].command;
  assert.ok(command.includes(hookScriptPath()), '缺脚本路径');
  assert.ok(command.endsWith(' Stop'), `事件名应在末尾: ${command}`);
  assert.ok(command.startsWith('/usr/bin/node '), '应使用显式 node 路径');
});

test('重复安装是幂等的，不会堆出重复条目', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  const first = read().hooks.Stop.length;
  const again = installHooks({ nodePath: '/usr/bin/node' });
  assert.equal(again.installed.length, 0);
  assert.equal(again.alreadyInstalled.length, HOOK_EVENTS.length);
  assert.equal(read().hooks.Stop.length, first, '不应新增分组');
});

test('重装会刷新命令（换了 node 路径或仓库位置）', () => {
  installHooks({ nodePath: '/old/node' });
  installHooks({ nodePath: '/new/node' });
  const command = read().hooks.Stop[0].hooks[0].command;
  assert.ok(command.startsWith('/new/node '));
  assert.equal(read().hooks.Stop[0].hooks.length, 1, '不应留下旧条目');
});

// ---------- 不越界 ----------

test('保留用户已有的其他设置项', () => {
  write({ model: 'opus', env: { FOO: '1' }, permissions: { allow: ['Bash'] } });
  installHooks({ nodePath: '/usr/bin/node' });
  const settings = read();
  assert.equal(settings.model, 'opus');
  assert.deepEqual(settings.env, { FOO: '1' });
  assert.deepEqual(settings.permissions, { allow: ['Bash'] });
});

test('保留用户自己写的 hook，安装只是追加', () => {
  write({
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: '/usr/bin/say done' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/local/bin/audit.sh' }] }],
    },
  });
  installHooks({ nodePath: '/usr/bin/node' });
  const settings = read();
  const stopCommands = settings.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(stopCommands.some((c) => c.includes('say done')), '用户的 hook 被弄丢了');
  assert.ok(stopCommands.some((c) => c.includes('maclawd-hook.js')));
  const preCommands = settings.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(preCommands.some((c) => c.includes('audit.sh')));
  // 用户那条的 matcher 不能被改
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
});

test('卸载只移除自己的条目', () => {
  write({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: '/usr/bin/say done' }] }],
    },
  });
  installHooks({ nodePath: '/usr/bin/node' });
  const result = uninstallHooks();
  assert.ok(result.removed.includes('Stop'));

  const settings = read();
  const commands = (settings.hooks?.Stop ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(commands, ['/usr/bin/say done'], '用户的 hook 必须原样保留');
  for (const event of HOOK_EVENTS) {
    const groups = settings.hooks?.[event] ?? [];
    const ours = groups.flatMap((g) => g.hooks ?? []).filter((h) => h.command.includes('maclawd-hook.js'));
    assert.equal(ours.length, 0, `${event} 还残留我们的条目`);
  }
});

test('同一分组里混着别人的 hook 时，只摘掉自己那条', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  // 手动把别人的 hook 塞进我们的分组里
  const settings = read();
  settings.hooks.Stop[0].hooks.push({ type: 'command', command: '/other/tool.sh' });
  write(settings);

  uninstallHooks();
  const after = read();
  const commands = after.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(commands, ['/other/tool.sh'], '同组里别人的 hook 必须保留');
});

test('卸载后如果没有任何 hook 了，就把 hooks 键也删掉', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  uninstallHooks();
  assert.equal('hooks' in read(), false, '不该留下空的 hooks 对象');
});

test('没装过时卸载是安全的空操作', () => {
  write({ model: 'opus' });
  const result = uninstallHooks();
  assert.deepEqual(result.removed, []);
  assert.deepEqual(read(), { model: 'opus' }, '不应改写文件');
});

// ---------- 稳健性 ----------

test('首次安装会备份原文件', () => {
  write({ model: 'opus' });
  const result = installHooks({ nodePath: '/usr/bin/node' });
  assert.equal(result.backedUp, true);
  assert.deepEqual(JSON.parse(readFileSync(`${SETTINGS}.maclawd-backup`, 'utf-8')), { model: 'opus' });
});

test('配置文件坏掉时拒绝安装，绝不覆盖', () => {
  writeFileSync(SETTINGS, '{ 这不是合法 JSON', 'utf-8');
  assert.throws(() => installHooks({ nodePath: '/usr/bin/node' }), /无法解析/);
  // 原文件必须原样保留，让用户自己去修
  assert.equal(readFileSync(SETTINGS, 'utf-8'), '{ 这不是合法 JSON');
});

test('空文件与不存在的文件都按空配置处理', () => {
  writeFileSync(SETTINGS, '   \n', 'utf-8');
  assert.doesNotThrow(() => installHooks({ nodePath: '/usr/bin/node' }));
  rmSync(SETTINGS);
  assert.doesNotThrow(() => installHooks({ nodePath: '/usr/bin/node' }));
});

test('hookStatus 如实报告已装与未装', () => {
  const before = hookStatus();
  assert.deepEqual(before.installed, []);
  assert.deepEqual(before.missing.sort(), [...HOOK_EVENTS].sort());

  installHooks({ nodePath: '/usr/bin/node' });
  const after = hookStatus();
  assert.deepEqual(after.installed.sort(), [...HOOK_EVENTS].sort());
  assert.deepEqual(after.missing, []);
});

test('写入的是合法 JSON 且带换行结尾', () => {
  installHooks({ nodePath: '/usr/bin/node' });
  const text = readFileSync(SETTINGS, 'utf-8');
  assert.doesNotThrow(() => JSON.parse(text));
  assert.ok(text.endsWith('\n'));
  assert.ok(!existsSync(`${SETTINGS}.maclawd.${process.pid}.tmp`), '临时文件应已被 rename 掉');
});
