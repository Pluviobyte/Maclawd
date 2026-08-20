import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Offboarding：卸载应用前的一键收尾。
 *
 * 守三件事：
 *   · 只移除自己的条目，第三方的原样保留（与安装器同一套身份判据）
 *   · 开关先关（否则自愈看门狗可能把刚移除的 hook 补回去）
 *   · 一个文件坏了不挡住其余目标的清理
 */

const root = mkdtempSync(join(tmpdir(), 'maclawd-offboard-'));
const CLAUDE_SETTINGS = join(root, 'claude', 'settings.json');
const CODEX_HOME = join(root, 'codex');
const CODEX_HOOKS = join(CODEX_HOME, 'hooks.json');
const WORKBUDDY_SETTINGS = join(root, 'workbuddy', 'settings.json');
const CURSOR_HOOKS = join(root, 'cursor', 'hooks.json');
const DATA_DIR = join(root, 'data');

process.env.MACLAWD_DATA_DIR = DATA_DIR;
process.env.MACLAWD_CLAUDE_SETTINGS = CLAUDE_SETTINGS;
process.env.MACLAWD_CODEX_HOME = CODEX_HOME;
process.env.MACLAWD_CODEX_HOOKS_PATH = CODEX_HOOKS;
process.env.MACLAWD_WORKBUDDY_SETTINGS = WORKBUDDY_SETTINGS;
process.env.MACLAWD_CURSOR_HOOKS_PATH = CURSOR_HOOKS;

const { offboard, removeCodexPet, codexPetDir } = await import('../src/runtime/offboard.js');
const { loadSettings } = await import('../src/runtime/settings.js');

const ours = (script, event) => ({
  type: 'command',
  command: `/x/node "/app/hooks/${script}" ${event}`,
  async: true,
  timeout: 5,
});
const foreign = { type: 'command', command: '/usr/bin/other-tool run' };

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

/** 每个用例从同一份「全都装着」的现场出发。 */
function resetFixtures() {
  rmSync(root, { recursive: true, force: true });

  writeJson(CLAUDE_SETTINGS, {
    model: 'opus',
    hooks: {
      SessionStart: [
        { hooks: [ours('maclawd-hook.js', 'SessionStart')] },
        { hooks: [foreign] },
      ],
      Stop: [{ hooks: [ours('maclawd-hook.js', 'Stop')] }],
      PermissionRequest: [{
        hooks: [{ type: 'http', url: 'http://127.0.0.1:4173/api/permission?agent=claude-code', timeout: 30 }],
      }],
    },
    statusLine: { type: 'command', command: '/x/node "/app/hooks/maclawd-statusline.js" --chain' },
  });
  writeFileSync(`${CLAUDE_SETTINGS}.maclawd-backup`, '{}\n', 'utf-8');

  writeJson(CODEX_HOOKS, {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: '/x/node "/app/hooks/maclawd-codex-hook.js" SessionStart', timeout: 2 }] }],
      PermissionRequest: [{ hooks: [{ type: 'command', command: '/x/node "/app/hooks/maclawd-codex-hook.js" PermissionRequest', timeout: 30 }] }],
      SessionEnd: [{ hooks: [foreign] }],
    },
  });

  writeJson(WORKBUDDY_SETTINGS, {
    hooks: {
      SessionStart: [{
        hooks: [{
          type: 'command',
          command: '"/x/node" "/app/hooks/maclawd-hook.js" SessionStart --maclawd-source=workbuddy',
          timeout: 5,
        }],
      }],
    },
  });

  writeJson(CURSOR_HOOKS, {
    version: 1,
    hooks: {
      stop: [
        { command: '"/x/node" "/app/hooks/maclawd-cursor-hook.js"' },
        foreign,
      ],
    },
  });

  // chain 模式的 sidecar：用户原来的状态行压在 Maclawd 数据目录里
  mkdirSync(DATA_DIR, { recursive: true });
  writeJson(join(DATA_DIR, 'statusline-chain.json'), { type: 'command', command: '/usr/local/bin/myline' });

  // 全部开关处于开启态，offboard 之后必须全关
  writeJson(join(DATA_DIR, 'settings.json'), {
    hookEnhancement: true,
    codexHookEnhancement: true,
    workBuddyHookEnhancement: true,
    cursorHookEnhancement: true,
    permissionBubble: true,
    quotaStatusline: true,
    quotaTracking: true,
  });

  const pet = join(CODEX_HOME, 'pets', 'maclawd');
  mkdirSync(pet, { recursive: true });
  writeJson(join(pet, 'pet.json'), {
    id: 'maclawd', displayName: 'Maclawd', description: '', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp',
  });
  writeFileSync(join(pet, 'spritesheet.webp'), 'x', 'utf-8');
}

test('完整 offboard：自己的全移除，别人的全保留，开关全关', () => {
  resetFixtures();
  const r = offboard();

  assert.equal(r.ok, true, JSON.stringify(r.errors));

  const claude = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8'));
  assert.equal(claude.model, 'opus', '不相干的键必须原样保留');
  assert.deepEqual(claude.hooks.SessionStart, [{ hooks: [foreign] }], '第三方 hook 必须原样保留');
  assert.equal(claude.hooks.Stop, undefined, '只剩我们的分组要整组删掉');
  assert.equal(claude.hooks.PermissionRequest, undefined, '权限通道要一并移除');
  assert.deepEqual(claude.statusLine, { type: 'command', command: '/usr/local/bin/myline' },
    'chain 模式必须把用户原来的状态行原样还原');

  const codex = JSON.parse(readFileSync(CODEX_HOOKS, 'utf-8'));
  assert.deepEqual(Object.keys(codex.hooks), ['SessionEnd'], 'Codex 里只留第三方条目');

  const workbuddy = JSON.parse(readFileSync(WORKBUDDY_SETTINGS, 'utf-8'));
  assert.equal(workbuddy.hooks, undefined, 'WorkBuddy 的条目要清空');

  const cursor = JSON.parse(readFileSync(CURSOR_HOOKS, 'utf-8'));
  assert.deepEqual(cursor.hooks.stop, [foreign], 'Cursor 里只保留第三方 stop hook');

  assert.equal(existsSync(codexPetDir()), false, '可识别的宠物包要移除');

  const settings = loadSettings();
  for (const key of ['hookEnhancement', 'codexHookEnhancement', 'workBuddyHookEnhancement',
    'cursorHookEnhancement',
    'permissionBubble', 'quotaStatusline', 'quotaTracking']) {
    assert.equal(settings[key], false, `${key} 必须已关闭`);
  }

  assert.ok(r.leftovers.backups.includes(`${CLAUDE_SETTINGS}.maclawd-backup`),
    '备份文件保留并如实上报');
  assert.equal(r.leftovers.dataDir, DATA_DIR);
});

test('陌生的同名宠物目录一根手指都不碰', () => {
  resetFixtures();
  const pet = codexPetDir();
  writeJson(join(pet, 'pet.json'), { id: 'someone-elses-pet' });

  const r = offboard();
  assert.equal(existsSync(pet), true, '不是我们的包就不删');
  assert.match(r.actions.codexPet.blocked, /不是可识别的/);
  assert.equal(r.ok, true, '拒绝删除陌生目录是规则，不是错误');
});

test('pet.json 损坏时同样拒绝删除', () => {
  resetFixtures();
  writeFileSync(join(codexPetDir(), 'pet.json'), '{broken', 'utf-8');
  const r = removeCodexPet();
  assert.equal(r.removed, false);
  assert.equal(existsSync(codexPetDir()), true);
});

test('一个文件坏了不挡住其余目标，且开关照样全关', () => {
  resetFixtures();
  writeFileSync(CLAUDE_SETTINGS, '{not json', 'utf-8');

  const r = offboard();
  assert.equal(r.ok, false);
  const failed = r.errors.map((e) => e.target).sort();
  assert.deepEqual(failed, ['claudeHooks', 'claudePermission'],
    'Claude 的两步失败，其余目标不该被连坐');
  assert.equal(r.actions.statusline.removed, false, '状态行卸载对坏文件的降级是「不动」');

  const codex = JSON.parse(readFileSync(CODEX_HOOKS, 'utf-8'));
  assert.deepEqual(Object.keys(codex.hooks), ['SessionEnd'], 'Codex 清理照常完成');
  assert.equal(existsSync(codexPetDir()), false, '宠物包移除照常完成');

  const settings = loadSettings();
  assert.equal(settings.hookEnhancement, false,
    '开关必须在动文件之前就关掉——这保证重试 offboard 永远安全');
});
