import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 状态行脚本跑在**用户的终端里**，stdout 就是他看到的那一行。
 *
 * 所以这里一条业务逻辑都不测，只测三件事：
 *   1. 永远打印点什么（崩了或卡住 = 用户的状态行一片空白）
 *   2. 永远退出码 0（非零会污染 agent 的输出）
 *   3. 永远在有限时间内返回
 *
 * 输入用的是 2026-08-03 从本机 Claude Code v2.1.220 真实抓到的 payload，
 * 不是照文档编的——文档没说第一条 payload 会缺 rate_limits，是实测发现的。
 */

const SCRIPT = fileURLToPath(new URL('../hooks/maclawd-statusline.js', import.meta.url));
const DATA = mkdtempSync(join(tmpdir(), 'maclawd-slscript-'));
after(() => rmSync(DATA, { recursive: true, force: true }));

/** 真实抓到的第二条（有 rate_limits）。 */
const REAL_WITH_QUOTA = {
  session_id: '265b9d7a-8c84-4f8d-ad8e-c2c97624a681',
  cwd: '/private/tmp/probe',
  model: { id: 'claude-opus-4-6[1m]', display_name: 'Opus 4.6 (1M context)' },
  workspace: { current_dir: '/Users/rain/Desktop/Maclawd', project_dir: '/Users/rain/Desktop/Maclawd' },
  version: '2.1.220',
  cost: { total_cost_usd: 0.35380700000000004, total_duration_ms: 9581 },
  context_window: {
    total_input_tokens: 35314, total_output_tokens: 4,
    context_window_size: 1000000, used_percentage: 4, remaining_percentage: 96,
    current_usage: { input_tokens: 3, output_tokens: 4, cache_creation_input_tokens: 35311, cache_read_input_tokens: 0 },
  },
  rate_limits: {
    five_hour: { used_percentage: 15, resets_at: 1785746400 },
    seven_day: { used_percentage: 3, resets_at: 1786287600 },
  },
};

/** 真实抓到的第一条：**没有** rate_limits，且 used_percentage 是 null。 */
const REAL_FIRST = {
  cwd: '/private/tmp/probe',
  model: { id: 'claude-opus-4-6[1m]', display_name: 'Opus 4.6 (1M context)' },
  workspace: { current_dir: '/Users/rain/Desktop/Maclawd' },
  version: '2.1.220',
  cost: { total_cost_usd: 0, total_duration_ms: 1337 },
  context_window: {
    total_input_tokens: 0, total_output_tokens: 0,
    context_window_size: 1000000,
    current_usage: null, used_percentage: null, remaining_percentage: null,
  },
};

/**
 * 跑一次脚本。MACLAWD_PORT 指到一个没人监听的端口，
 * 这样 POST 会立刻 ECONNREFUSED——既验证了「运行时没开也要正常出字」，
 * 也保证测试绝不会往用户真在跑的 Maclawd 里塞数据。
 */
function run(stdinText, { args = [], dataDir = DATA, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MACLAWD_DATA_DIR: dataDir, MACLAWD_PORT: '59997' },
    });
    let out = '';
    let err = '';
    const started = Date.now();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ out, err, code: null, timedOut: true, ms: Date.now() - started });
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out, err, code, timedOut: false, ms: Date.now() - started });
    });
    child.stdin.end(stdinText);
  });
}

// ---------- 正常路径 ----------

test('真实 payload → 打印出模型、目录和 5 小时额度', async () => {
  const r = await run(JSON.stringify(REAL_WITH_QUOTA));
  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0);
  assert.match(r.out, /Opus 4\.6/);
  assert.match(r.out, /Maclawd/);
  assert.match(r.out, /5h 15%/);
});

test('第一条 payload 缺 rate_limits → 照常出字，不报错', async () => {
  const r = await run(JSON.stringify(REAL_FIRST));
  assert.equal(r.code, 0);
  assert.ok(r.out.trim().length > 0, '缺额度是正常路径，不是错误');
  assert.doesNotMatch(r.out, /5h/, '没有的东西不该凭空出现');
});

test('context used_percentage 是 null → 不打印「ctx 0%」', async () => {
  const r = await run(JSON.stringify(REAL_FIRST));
  assert.doesNotMatch(r.out, /ctx/,
    'null 折成 0 会显示一个看起来正常的假数字');
});

// ---------- 永不空白 ----------

test('stdin 是垃圾 → 仍然打印点什么', async () => {
  const r = await run('{ 这不是 JSON');
  assert.equal(r.code, 0);
  assert.ok(r.out.trim().length > 0);
});

test('stdin 为空 → 仍然打印点什么', async () => {
  const r = await run('');
  assert.equal(r.code, 0);
  assert.ok(r.out.trim().length > 0);
});

test('运行时没开 → 静默，stderr 不留痕迹', async () => {
  const r = await run(JSON.stringify(REAL_WITH_QUOTA));
  assert.equal(r.code, 0);
  assert.equal(r.err.trim(), '',
    '桌宠没开不该在用户的终端里留下任何错误');
});

test('POST 打不通也不该拖慢渲染', async () => {
  const r = await run(JSON.stringify(REAL_WITH_QUOTA));
  assert.ok(r.ms < 3000, `耗时 ${r.ms}ms，状态行刷新不能等这么久`);
});

// ---------- chain 模式 ----------

function writeSidecar(dir, command) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'statusline-chain.json'),
    JSON.stringify({ type: 'command', command }, null, 2), 'utf-8');
}

test('chain 模式 → 原样转发用户脚本的输出', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-chain-'));
  writeSidecar(dir, 'echo "用户自己的状态行"');
  const r = await run(JSON.stringify(REAL_WITH_QUOTA), { args: ['--chain'], dataDir: dir });

  assert.equal(r.code, 0);
  assert.match(r.out, /用户自己的状态行/);
  assert.doesNotMatch(r.out, /Opus/, 'chain 模式下渲染权完全交给用户的脚本');
  rmSync(dir, { recursive: true, force: true });
});

test('chain 模式 → 三层引号的命令原样交给 shell，不做任何拆分', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-chain2-'));
  // 形状照抄本机 claude-hud 那条：bash -c 里再嵌 awk 的单引号逃逸
  writeSidecar(dir, `bash -c 'printf "%s" $(echo x | awk '"'"'{ print "深层引号还活着" }'"'"')'`);
  const r = await run(JSON.stringify(REAL_WITH_QUOTA), { args: ['--chain'], dataDir: dir });

  assert.equal(r.code, 0);
  assert.match(r.out, /深层引号还活着/);
  rmSync(dir, { recursive: true, force: true });
});

test('chain 的脚本卡住 → 3 秒内回落到自己那行，不无限等', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-chain3-'));
  writeSidecar(dir, 'sleep 30');
  const r = await run(JSON.stringify(REAL_WITH_QUOTA), { args: ['--chain'], dataDir: dir, timeoutMs: 10000 });

  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0);
  assert.ok(r.ms < 6000, `等了 ${r.ms}ms；Claude Code 刷新很密，卡住会累积孤儿进程`);
  assert.match(r.out, /Opus 4\.6/, '用户的脚本挂了要回落，不能留空');
  rmSync(dir, { recursive: true, force: true });
});

test('chain 的脚本崩了 → 回落而不是跟着崩', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-chain4-'));
  writeSidecar(dir, 'exit 3');
  const r = await run(JSON.stringify(REAL_WITH_QUOTA), { args: ['--chain'], dataDir: dir });

  assert.equal(r.code, 0, '别人的脚本崩了不该让我们的退出码也变脏');
  assert.ok(r.out.trim().length > 0);
  rmSync(dir, { recursive: true, force: true });
});

test('标了 --chain 但 sidecar 不见了 → 回落，不留空', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-chain5-'));
  mkdirSync(dir, { recursive: true });
  const r = await run(JSON.stringify(REAL_WITH_QUOTA), { args: ['--chain'], dataDir: dir });

  assert.equal(r.code, 0);
  assert.match(r.out, /Opus 4\.6/);
  rmSync(dir, { recursive: true, force: true });
});
