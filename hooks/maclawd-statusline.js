#!/usr/bin/env node
/**
 * Maclawd 的 Claude Code 状态行适配器。
 *
 * 由 `maclawd-usage statusline install` 写进 `~/.claude/settings.json` 的
 * `statusLine.command`。Claude Code 每次刷新状态行，把一个 JSON 从 stdin
 * 喂进来（字段见 https://code.claude.com/docs/en/statusline），
 * 并把我们写到 stdout 的内容渲染成用户终端里那一行。
 *
 * 这个文件跑在**用户的终端里**，所以约束和 hook 写入器不同，更严：
 *
 * 1. **永不抛异常、永远打印点什么。** stdout 就是用户的状态行。
 *    崩一次或者卡住，用户看到的是一片空白——而且他多半会以为是
 *    Claude Code 坏了，不会想到是 Maclawd。
 *
 * 2. **渲染优先于上报。** 先把可见文字写出去，再去管 POST。
 *    POST 有 150ms 硬超时，即发即忘；运行时没开就当无事发生。
 *
 * 3. **chain 模式下我们只是个旁路。** 用户原来的状态行脚本负责渲染，
 *    我们只虹吸 rate_limits。子进程 3 秒硬上限——Claude Code 刷新很密
 *    且不串行化重叠调用，一个卡住的脚本会不断累积孤儿进程。
 *
 * 实测（2026-08-03，v2.1.220）：会话第一条 payload **没有** rate_limits，
 * 要等第一次 API 响应之后才有。所以字段缺失是正常路径，不是错误。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverPort } from '../src/runtime/endpoint.js';
import { dataDir } from '../src/runtime/paths.js';
import { CHAIN_SIDECAR_FILE } from '../src/runtime/statusline-install.js';

const STDIN_TIMEOUT_MS = 800;
const POST_TIMEOUT_MS = 150;
const CHAIN_TIMEOUT_MS = 3000;
const MAX_STDIN_BYTES = 1 << 20;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_STDIN_BYTES) finish();
    });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

// ---------- 取数 ----------

/**
 * 只接受**真的是数字**的值。`Number(null)` 是 `0`——而 payload 里的 null
 * 恰恰表示「这一项暂时没有」（实测冷启动时 context_window.used_percentage
 * 就是 null）。折成 0 会上报一个假的「0%」。
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 从 payload 里摘出额度。**任何一层缺失都返回 null 而不是 0。**
 *
 * 实测冷启动时 `context_window.used_percentage` 是 `null`，不是 0；
 * 把 null 当 0 会让面板显示「上下文 0%」——那是个看起来正常的假数字，
 * 比空着更糟。
 */
function extractQuota(payload) {
  const limits = payload?.rate_limits;
  const windows = {};
  if (limits && typeof limits === 'object') {
    for (const key of ['five_hour', 'seven_day']) {
      const bucket = limits[key];
      if (!bucket || typeof bucket !== 'object') continue;
      const usedPercent = num(bucket.used_percentage);
      if (usedPercent === null) continue;
      const entry = { usedPercent };
      const resetsAt = num(bucket.resets_at);
      // 文档说是绝对 Unix 秒。统一换成毫秒，和仓库里其它时间戳一个单位。
      if (resetsAt !== null) entry.resetAt = Math.round(resetsAt * 1000);
      windows[key] = entry;
    }
  }

  const cw = payload?.context_window;
  let context = null;
  if (cw && typeof cw === 'object') {
    const used = num(cw.used_percentage);
    const size = num(cw.context_window_size);
    // used 为 null 是冷启动的正常状态，此时整块不上报
    if (used !== null) {
      context = { usedPercent: used, windowSize: size };
    }
  }

  const cost = num(payload?.cost?.total_cost_usd);

  if (Object.keys(windows).length === 0 && !context && cost === null) return null;
  return {
    source: 'claude-code',
    windows,
    context,
    sessionCostUsd: cost,
    model: typeof payload?.model?.id === 'string' ? payload.model.id : null,
    version: typeof payload?.version === 'string' ? payload.version : null,
  };
}

// ---------- 上报 ----------

async function postQuota(payload) {
  const quota = extractQuota(payload);
  if (!quota) return;
  let port;
  try {
    port = discoverPort();
  } catch {
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  timer.unref?.();
  try {
    await fetch(`http://127.0.0.1:${port}/api/quota`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(quota),
      signal: controller.signal,
    });
  } catch {
    // Maclawd 没开、端口换了、超时——全部当无事发生。
    // 桌宠没开不该在用户的终端里留下任何痕迹。
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 渲染 ----------

function countdown(resetAtMs, now = Date.now()) {
  if (!Number.isFinite(resetAtMs)) return null;
  const secs = Math.round((resetAtMs - now) / 1000);
  if (secs <= 0) return '即将重置';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

function basename(path) {
  if (typeof path !== 'string' || !path) return null;
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || null;
}

/**
 * 自己渲染的那一行。占了用户的状态行槽位就得还回去点价值，
 * 不能只是虹吸数据然后打印一个空字符串。
 */
function renderOwn(payload) {
  const parts = [];
  const model = payload?.model?.display_name || payload?.model?.id;
  if (model) parts.push(model);
  const dir = basename(payload?.workspace?.current_dir ?? payload?.cwd);
  if (dir) parts.push(dir);

  const five = payload?.rate_limits?.five_hour;
  const used = num(five?.used_percentage);
  if (used !== null) {
    // resets_at 缺失时 countdown 必须收到 null 而不是 0——
    // null * 1000 === 0 会被算成「已经过期」，显示成「即将重置」。
    const resetSec = num(five?.resets_at);
    const left = resetSec === null ? null : countdown(resetSec * 1000);
    parts.push(left ? `5h ${Math.round(used)}% · ${left}` : `5h ${Math.round(used)}%`);
  }

  const ctx = num(payload?.context_window?.used_percentage);
  if (ctx !== null && ctx > 0) parts.push(`ctx ${Math.round(ctx)}%`);

  return parts.length > 0 ? parts.join(' · ') : 'Maclawd';
}

function readChainedCommand() {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir(), CHAIN_SIDECAR_FILE), 'utf-8'));
    const command = raw?.command;
    return (typeof command === 'string' && command.trim()) ? command : null;
  } catch {
    return null;
  }
}

/**
 * 跑用户原来的状态行脚本，把它的 stdout 原样转出去。
 *
 * 命令是从 sidecar 里**原样**读出来的一整条 shell 单行，所以只能整体交给
 * shell 执行，绝不能尝试拆分或重新转义——本机 claude-hud 那条就嵌套了
 * 三层引号，拆一次就废。
 */
function runChained(command, stdinText) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (text) => { if (!settled) { settled = true; resolve(text); } };

    let child;
    try {
      child = spawn('/bin/sh', ['-c', command], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: process.env,
      });
    } catch {
      done(null);
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已经退了 */ }
      done(null);
    }, CHAIN_TIMEOUT_MS);
    timer.unref?.();

    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', () => { clearTimeout(timer); done(out); });

    try {
      child.stdin.on('error', () => { /* 对方不读 stdin 是允许的 */ });
      child.stdin.end(stdinText);
    } catch {
      // 写不进去就让它自己跑，多数状态行脚本不读 stdin 也能出东西
    }
  });
}

// ---------- 主流程 ----------

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') payload = parsed;
  } catch {
    // 不是 JSON 也要继续：渲染兜底那一行，别让状态行空掉
  }

  // 上报先发出去但不等它——渲染的优先级更高。
  const posting = postQuota(payload);

  if (process.argv.includes('--chain')) {
    const command = readChainedCommand();
    const relayed = command ? await runChained(command, raw) : null;
    // 用户的脚本挂了或超时 → 回落到我们自己那行，而不是留空。
    process.stdout.write(relayed !== null && relayed !== ''
      ? (relayed.endsWith('\n') ? relayed : `${relayed}\n`)
      : `${renderOwn(payload)}\n`);
  } else {
    process.stdout.write(`${renderOwn(payload)}\n`);
  }

  await posting;
}

// 任何逃逸出来的异常都必须以「打印了点东西 + 退出码 0」收场。
main().catch(() => {
  try { process.stdout.write('Maclawd\n'); } catch { /* stdout 都写不了就算了 */ }
  process.exit(0);
});
