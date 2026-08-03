import { existsSync, readFileSync, renameSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.js';
import {
  backupOnce, readSettings, repoRoot, settingsPath, writeSettings,
} from './hook-install.js';

/**
 * Claude Code 状态行（statusLine）注册 / 卸载。
 *
 * 这是订阅额度的唯一来源：Claude Code 每次刷新状态行，把一个 JSON 从 stdin
 * 喂给注册的脚本，里面带 `rate_limits`（5 小时 / 7 天窗口的已用百分比与重置
 * 时刻）、`context_window`、`cost`。见 design/quota-and-panel.md 第二节。
 *
 * **它和 hooks 有一个本质区别：statusLine 是单槽位。**
 *
 * `settings.hooks` 是按事件分组的数组，往里追加一条谁也不影响；
 * `settings.statusLine` 只有一个位置，占了就把用户原来的挤掉了。
 * 所以这里的规则比 hook-install.js 更严：
 *
 * 1. **发现不是自己的状态行，默认什么都不做。** 只有显式 `chainExisting`
 *    才接管。
 * 2. **接管时把原对象原样存进 sidecar。** 不解析、不重写、不规范化。
 * 3. **sidecar 是文件，不是命令行参数。** 真实的状态行命令是任意引号的
 *    shell 单行——本机 claude-hud 那条就嵌套了三层引号
 *    （`bash -c '... awk '"'"'...'"'"' ...'`），任何试图把它塞进 argv 或
 *    重新转义的做法都会坏掉。
 * 4. **卸载严格对称。** 只在当前槽位仍然是我们写的那条时才动它；
 *    用户中途自己改过就原样留着。
 * 5. sidecar 放在 Maclawd 自己的数据目录，不往 ~/.claude 里丢文件。
 * 6. 脚本本身永不抛异常（见 hooks/maclawd-statusline.js）。
 */

const STATUSLINE_SCRIPT = 'hooks/maclawd-statusline.js';
export const CHAIN_SIDECAR_FILE = 'statusline-chain.json';

export function statuslineScriptPath() {
  return join(repoRoot(), STATUSLINE_SCRIPT);
}

export function chainSidecarPath() {
  return join(dataDir(), CHAIN_SIDECAR_FILE);
}

/**
 * 这条 statusLine 是我们写的吗？只认脚本路径，和 hook-install.js 的
 * isOurs 同一套判据——不依赖任何我们自己加的标记字段，因为用户可能
 * 手工编辑过 settings.json 而把标记弄丢，那时误判会导致我们去改别人的配置。
 */
function isOurs(entry, script = statuslineScriptPath()) {
  return Boolean(entry)
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof entry.command === 'string'
    && entry.command.includes(script);
}

function ourEntry({ nodePath, script, chained }) {
  const args = [JSON.stringify(script)];
  if (chained) args.push('--chain');
  return {
    type: 'command',
    command: `${nodePath} ${args.join(' ')}`,
  };
}

function readSidecar() {
  try {
    const raw = JSON.parse(readFileSync(chainSidecarPath(), 'utf-8'));
    // 只接受「长得像 statusLine 对象」的东西。存进去的是什么就还原什么，
    // 但不能因为文件被写坏了就把垃圾塞回用户的配置里。
    if (raw && typeof raw === 'object' && !Array.isArray(raw)
      && typeof raw.command === 'string' && raw.command.trim()) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSidecar(value) {
  mkdirSync(dataDir(), { recursive: true });
  const target = chainSidecarPath();
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(temp, target);
}

function removeSidecar() {
  try {
    unlinkSync(chainSidecarPath());
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

/**
 * 当前状态。四种互斥情形，面板据此决定显示什么：
 *
 * - `none`     槽位空着，可以直接装
 * - `ours`     已经是我们的
 * - `chained`  是我们的，且身下压着用户原来的（sidecar 有内容）
 * - `foreign`  别人的状态行，**默认不动**
 */
export function statuslineStatus() {
  const path = settingsPath();
  let settings;
  try {
    settings = readSettings(path);
  } catch (err) {
    return { state: 'unknown', path, error: err.message, command: null, chainable: false };
  }
  const entry = settings.statusLine;
  const script = statuslineScriptPath();

  if (!entry || typeof entry !== 'object' || typeof entry.command !== 'string') {
    return { state: 'none', path, command: null, chainable: false, scriptExists: existsSync(script) };
  }
  if (isOurs(entry, script)) {
    const chained = entry.command.includes('--chain');
    return {
      state: chained ? 'chained' : 'ours',
      path,
      command: entry.command,
      chainable: false,
      foreignCommand: chained ? (readSidecar()?.command ?? null) : null,
    };
  }
  return {
    state: 'foreign',
    path,
    command: entry.command,
    // 别人的状态行可以被「接管并保留」，但必须是用户显式点的
    chainable: true,
  };
}

/**
 * 安装。
 *
 * @param {object}  opts
 * @param {string}  opts.nodePath        用哪个 node 跑脚本
 * @param {boolean} opts.chainExisting   槽位被别人占着时是否接管（默认 false）
 *
 * @returns {{ok: boolean, state: string, blocked?: boolean, path: string,
 *            chained: boolean, foreignCommand?: string}}
 *
 * `blocked: true` 表示**什么都没做**——槽位是别人的，而调用方没有明确
 * 要求接管。这不是错误，是规则 1。
 */
export function installStatusline({ nodePath = process.execPath, chainExisting = false } = {}) {
  const path = settingsPath();
  const script = statuslineScriptPath();
  const settings = readSettings(path);
  const existing = settings.statusLine;

  const existingIsOurs = isOurs(existing, script);
  const existingIsForeign = Boolean(existing)
    && typeof existing === 'object'
    && typeof existing.command === 'string'
    && existing.command.trim()
    && !existingIsOurs;

  if (existingIsForeign && !chainExisting) {
    // 规则 1：不问就不碰。连备份都不做——我们根本没打算写。
    return {
      ok: false,
      blocked: true,
      state: 'foreign',
      path,
      chained: false,
      foreignCommand: existing.command,
    };
  }

  backupOnce(path);

  let chained = false;
  if (existingIsForeign && chainExisting) {
    // 规则 2：原样存。这里存的是**整个对象**，不只是 command——
    // 用户可能配了 padding 之类我们不认识的字段，还原时必须一起还回去。
    writeSidecar(existing);
    chained = true;
  } else if (existingIsOurs) {
    // 重装（换了 node 路径或仓库位置）。原来是不是 chain 模式要保持住，
    // 否则一次重装就会把用户压在下面的状态行永久孤儿化。
    chained = existing.command.includes('--chain') && readSidecar() !== null;
  }

  settings.statusLine = ourEntry({ nodePath, script, chained });
  writeSettings(path, settings);

  return {
    ok: true,
    state: chained ? 'chained' : 'ours',
    path,
    chained,
    foreignCommand: chained ? readSidecar()?.command ?? null : null,
  };
}

/**
 * 卸载。规则 4：只在槽位仍然是我们的时候才动。
 *
 * chain 模式下把 sidecar 里的对象原样放回去；否则删掉 statusLine 键
 * （而不是留一个空对象——那会让 Claude Code 认为配了个坏状态行）。
 */
export function uninstallStatusline() {
  const path = settingsPath();
  const script = statuslineScriptPath();
  let settings;
  try {
    settings = readSettings(path);
  } catch (err) {
    return { removed: false, path, error: err.message };
  }
  const entry = settings.statusLine;

  if (!isOurs(entry, script)) {
    // 用户中途自己换了状态行。原样留着，并且**不删 sidecar**——
    // 里面还压着他更早那份，删了就再也还不回去了。
    return { removed: false, path, foreign: Boolean(entry), restored: false };
  }

  const restore = entry.command.includes('--chain') ? readSidecar() : null;
  if (restore) settings.statusLine = restore;
  else delete settings.statusLine;

  writeSettings(path, settings);
  removeSidecar();
  return { removed: true, path, restored: Boolean(restore), foreign: false };
}
