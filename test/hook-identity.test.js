import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * hook 条目的身份判定。
 *
 * 实测撞到的问题：hook 从源码目录装上，而打包后的 app 把 hookScriptPath()
 * 解析到自己包里的那份副本。两条完整路径对不上，于是**装好的 14 个 hook
 * 被报成「一个都没装」**。移动过 .app、或者升级过版本，都会撞上同一件事。
 *
 * 显示不准只是表面。真正的风险是自愈：它看到「没装」就会再装一套指向
 * 新路径的，用户拿到的是每个事件触发两次。
 */

function withSettings(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-hookid-'));
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(content, null, 2), 'utf8');
  const before = process.env.MACLAWD_CLAUDE_SETTINGS;
  process.env.MACLAWD_CLAUDE_SETTINGS = path;
  return (async () => {
    try {
      return await fn(path);
    } finally {
      if (before === undefined) delete process.env.MACLAWD_CLAUDE_SETTINGS;
      else process.env.MACLAWD_CLAUDE_SETTINGS = before;
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

/** 造一份「装在别的路径上」的 hook 配置。 */
function settingsFrom(scriptPath, events) {
  const hooks = {};
  for (const event of events) {
    hooks[event] = [{
      hooks: [{ type: 'command', command: `/usr/bin/node ${JSON.stringify(scriptPath)} ${event}`, async: true }],
    }];
  }
  return { hooks };
}

test('装在别的路径上的同一个 hook 仍然认得出来', () => {
  const events = ['SessionStart', 'PreToolUse', 'Stop'];
  const foreign = '/Applications/Maclawd.app/Contents/Resources/runtime/hooks/maclawd-hook.js';
  return withSettings(settingsFrom(foreign, events), async () => {
    const { hookStatus } = await import('../src/runtime/hook-install.js?case=foreign');
    const status = hookStatus();
    for (const event of events) {
      assert.ok(status.installed.includes(event),
        `${event} 装在 ${foreign} 上，应当被认出来而不是报成没装`);
    }
  });
});

test('别人的 hook 不会被误认成我们的', () => {
  const other = { hooks: {
    PreToolUse: [{ hooks: [{ type: 'command', command: '/usr/bin/node /opt/other-tool/hook.js PreToolUse' }] }],
  } };
  return withSettings(other, async () => {
    const { hookStatus } = await import('../src/runtime/hook-install.js?case=other');
    assert.equal(hookStatus().installed.length, 0, '别的工具的 hook 不是我们的');
  });
});

test('重新安装会把路径刷新到当前这份，而不是再加一条', () => {
  const events = ['SessionStart'];
  const stale = '/old/location/hooks/maclawd-hook.js';
  return withSettings(settingsFrom(stale, events), async (path) => {
    const m = await import('../src/runtime/hook-install.js?case=refresh');
    m.installHooks({ nodePath: '/usr/bin/node' });
    const { readFileSync } = await import('node:fs');
    const after = JSON.parse(readFileSync(path, 'utf8'));
    const entries = after.hooks.SessionStart.flatMap((g) => g.hooks);
    const ours = entries.filter((e) => String(e.command).includes('maclawd-hook.js'));
    assert.equal(ours.length, 1, `不该留下两条重复的 hook，实际 ${ours.length} 条`);
    assert.ok(!String(ours[0].command).includes('/old/location'), '旧路径应当被刷新掉');
  });
});

test('卸载能清掉装在别的路径上的那份', () => {
  const events = ['SessionStart', 'Stop'];
  const foreign = '/Applications/Maclawd.app/Contents/Resources/runtime/hooks/maclawd-hook.js';
  return withSettings(settingsFrom(foreign, events), async () => {
    const m = await import('../src/runtime/hook-install.js?case=uninstall');
    m.uninstallHooks();
    assert.equal(m.hookStatus().installed.length, 0,
      '卸载后不该还剩一份别的路径上的孤儿 hook');
  });
});
