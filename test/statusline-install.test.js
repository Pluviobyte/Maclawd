import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * statusLine 是**单槽位**，这是它和 hooks 的全部区别所在：
 * hooks 往数组里追加一条谁也不影响，statusLine 占了就把用户原来的挤掉。
 *
 * 所以测试重点只有一个：**不越界**。
 * 已验证的 Claude HUD 可以自动串联；未知对象没有确认就绝不修改。
 * 串联之后必须能一字不差地还回去。
 */

const root = mkdtempSync(join(tmpdir(), 'maclawd-sl-'));
const SETTINGS = join(root, 'settings.json');
const DATA = join(root, 'data');
process.env.MACLAWD_CLAUDE_SETTINGS = SETTINGS;
process.env.MACLAWD_DATA_DIR = DATA;

const {
  installStatusline, uninstallStatusline, statuslineStatus,
  statuslineScriptPath, chainSidecarPath,
} = await import('../src/runtime/statusline-install.js');

after(() => rmSync(root, { recursive: true, force: true }));

const read = () => JSON.parse(readFileSync(SETTINGS, 'utf-8'));
const write = (value) => writeFileSync(SETTINGS, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
const raw = () => readFileSync(SETTINGS, 'utf-8');

/**
 * 本机 claude-hud 真实用的那条命令，嵌套三层引号。
 * 任何试图解析、拆分或重新转义它的实现都会在这条上坏掉，所以测试就用它。
 */
const FOREIGN = {
  type: 'command',
  command: `bash -c 'plugin_dir=$(ls -d "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\\t" $(0) }'"'"' | sort -t. -k1,1n | tail -1 | cut -f2-); exec "/Users/rain/.bun/bin/bun" --env-file /dev/null "\${plugin_dir}src/index.ts"'`,
};

const UNKNOWN_STATUSLINE = {
  type: 'command',
  command: '/usr/local/bin/my-claude-hud-wrapper --compact',
};

beforeEach(() => {
  rmSync(SETTINGS, { force: true });
  rmSync(`${SETTINGS}.maclawd-backup`, { force: true });
  rmSync(DATA, { recursive: true, force: true });
});

// ---------- 规则 1：不问就不碰 ----------

test('槽位被别人占着 → 什么都不做，并如实报告对方的命令', () => {
  write({ statusLine: FOREIGN, model: 'opus' });
  const before = raw();

  const result = installStatusline({ nodePath: '/usr/bin/node' });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.foreignCommand, FOREIGN.command);
  assert.equal(raw(), before, '被挡下时连一个字节都不该写');
});

test('被挡下时连备份文件都不该产生——我们根本没打算写', () => {
  write({ statusLine: FOREIGN });
  installStatusline({ nodePath: '/usr/bin/node' });
  assert.equal(existsSync(`${SETTINGS}.maclawd-backup`), false);
});

test('自动兼容只认 Claude HUD，未知自定义状态行仍然不动', () => {
  write({ statusLine: UNKNOWN_STATUSLINE, model: 'opus' });
  const before = raw();

  const result = installStatusline({ nodePath: '/usr/bin/node', autoChainKnown: true });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(raw(), before);
  assert.equal(existsSync(chainSidecarPath()), false);
});

test('空槽位 → 直接装', () => {
  write({ model: 'opus' });
  const result = installStatusline({ nodePath: '/usr/bin/node' });

  assert.equal(result.ok, true);
  assert.equal(result.chained, false);
  const entry = read().statusLine;
  assert.equal(entry.type, 'command');
  assert.ok(entry.command.includes(statuslineScriptPath()));
  assert.ok(!entry.command.includes('--chain'));
  assert.equal(read().model, 'opus', '不该动别的键');
});

test('settings.json 根本不存在也能装', () => {
  const result = installStatusline({ nodePath: '/usr/bin/node' });
  assert.equal(result.ok, true);
  assert.ok(read().statusLine.command.includes(statuslineScriptPath()));
});

// ---------- 规则 2 / 3：接管必须原样保存 ----------

test('显式接管 → 原对象逐字段进 sidecar，槽位换成带 --chain 的我们', () => {
  write({ statusLine: FOREIGN });
  const result = installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });

  assert.equal(result.ok, true);
  assert.equal(result.chained, true);
  assert.ok(read().statusLine.command.includes('--chain'));

  const sidecar = JSON.parse(readFileSync(chainSidecarPath(), 'utf-8'));
  assert.deepEqual(sidecar, FOREIGN, '三层引号的命令必须一个字符都不差');
});

test('接管时用户配的未知字段也要一起存下来', () => {
  const withExtras = { ...FOREIGN, padding: 0, someFutureField: { a: 1 } };
  write({ statusLine: withExtras });
  installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });

  const sidecar = JSON.parse(readFileSync(chainSidecarPath(), 'utf-8'));
  assert.deepEqual(sidecar, withExtras, '不认识的字段不代表可以丢掉');
});

test('sidecar 存在 Maclawd 自己的数据目录，不往 ~/.claude 里丢文件', () => {
  assert.ok(chainSidecarPath().startsWith(DATA));
});

// ---------- 规则 4：卸载严格对称 ----------

test('装了再卸 → settings.json 逐字节回到动手之前', () => {
  write({ model: 'opus', permissions: { allow: ['Bash'] } });
  const before = raw();

  installStatusline({ nodePath: '/usr/bin/node' });
  assert.notEqual(raw(), before);

  const result = uninstallStatusline();
  assert.equal(result.removed, true);
  assert.equal(result.restored, false);
  assert.equal(raw(), before, '卸载后必须一个字节都不差');
});

test('接管了再卸 → 用户原来的状态行一字不差地回来', () => {
  write({ statusLine: FOREIGN, model: 'opus' });
  const before = raw();

  installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });
  const result = uninstallStatusline();

  assert.equal(result.removed, true);
  assert.equal(result.restored, true);
  assert.equal(raw(), before, '接管过的也必须逐字节还原');
  assert.equal(read().statusLine.command, FOREIGN.command);
  assert.equal(existsSync(chainSidecarPath()), false, 'sidecar 用完要清掉');
});

test('槽位已经被用户换成别的 → 卸载不动它，也不删 sidecar', () => {
  write({ statusLine: FOREIGN });
  installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });

  // 用户中途自己又换了一个
  const settings = read();
  settings.statusLine = { type: 'command', command: 'my-own-thing' };
  write(settings);

  const result = uninstallStatusline();
  assert.equal(result.removed, false);
  assert.equal(result.foreign, true);
  assert.equal(read().statusLine.command, 'my-own-thing', '用户后来选的不能被动');
  assert.ok(existsSync(chainSidecarPath()),
    'sidecar 里还压着他更早那份，删了就永远还不回去了');
});

test('没装过就卸载 → 无害', () => {
  write({ model: 'opus' });
  const before = raw();
  const result = uninstallStatusline();
  assert.equal(result.removed, false);
  assert.equal(raw(), before);
});

// ---------- 重装 ----------

test('项目搬家后仍识别旧 Maclawd 状态行并刷新绝对路径', () => {
  const oldScript = '/Users/rain/Desktop/Maclawd/hooks/maclawd-statusline.js';
  write({
    statusLine: {
      type: 'command',
      command: `/old/node ${JSON.stringify(oldScript)}`,
    },
  });

  assert.equal(statuslineStatus().state, 'ours',
    '同名 Maclawd 脚本只是换了安装位置，不该被当成第三方状态行');

  const result = installStatusline({ nodePath: '/current/node' });

  assert.equal(result.ok, true);
  assert.equal(result.chained, false);
  assert.ok(read().statusLine.command.startsWith('/current/node'));
  assert.ok(read().statusLine.command.includes(statuslineScriptPath()));
  assert.ok(!read().statusLine.command.includes(oldScript));
});

test('重装（换了 node 路径）→ 刷新命令但保住 chain 关系', () => {
  write({ statusLine: FOREIGN });
  installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });

  // 第二次调用不带 chainExisting——这正是「开关重新拨一次」会发生的事
  const again = installStatusline({ nodePath: '/opt/homebrew/bin/node' });

  assert.equal(again.ok, true);
  assert.equal(again.chained, true, '重装一次就把用户的状态行孤儿化是不可接受的');
  assert.ok(read().statusLine.command.startsWith('/opt/homebrew/bin/node'));
  assert.ok(read().statusLine.command.includes('--chain'));

  // 还能还原
  uninstallStatusline();
  assert.equal(read().statusLine.command, FOREIGN.command);
});

test('重装时 sidecar 被人删了 → 降级成非 chain，不留一个还不回去的 --chain', () => {
  write({ statusLine: FOREIGN });
  installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });
  rmSync(chainSidecarPath(), { force: true });

  const again = installStatusline({ nodePath: '/usr/bin/node' });
  assert.equal(again.chained, false);
  assert.ok(!read().statusLine.command.includes('--chain'),
    '带着 --chain 却没有 sidecar 会让状态行每次都回落，等于静默坏掉');
});

// ---------- 状态查询 ----------

test('statuslineStatus 分得清四种情形', () => {
  write({ model: 'opus' });
  assert.equal(statuslineStatus().state, 'none');

  write({ statusLine: FOREIGN });
  const foreign = statuslineStatus();
  assert.equal(foreign.state, 'foreign');
  assert.equal(foreign.chainable, true, '别人的状态行可以被接管，但要用户点');

  installStatusline({ nodePath: '/usr/bin/node', chainExisting: true });
  const chained = statuslineStatus();
  assert.equal(chained.state, 'chained');
  assert.equal(chained.foreignCommand, FOREIGN.command);

  uninstallStatusline();
  write({});
  installStatusline({ nodePath: '/usr/bin/node' });
  assert.equal(statuslineStatus().state, 'ours');
});

test('settings.json 坏掉时 → 报错但绝不覆盖', () => {
  writeFileSync(SETTINGS, '{ 这不是 JSON', 'utf-8');
  const before = raw();

  assert.equal(statuslineStatus().state, 'unknown');
  assert.throws(() => installStatusline({ nodePath: '/usr/bin/node' }));
  assert.equal(raw(), before, '解析失败时覆盖会把用户的配置弄丢');
});
