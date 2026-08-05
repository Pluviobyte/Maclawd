#!/usr/bin/env node
/**
 * Maclawd 的 Claude Code / WorkBuddy hook 写入器。
 *
 * 用法（由 `maclawd-usage hook install` 写进 ~/.claude/settings.json）：
 *   node <repo>/hooks/maclawd-hook.js <EventName> [--maclawd-source=workbuddy]
 *
 * 三条硬约束：
 *
 * 1. **绝不拖住 Claude Code。** 安装时以 `async: true` 注册，agent 不等它返回；
 *    这里再叠一层自我保护：读 stdin 与发请求都有硬超时，超时即放弃。
 *
 * 2. **命令原文永不离开本进程。** Bash 的 `tool_input.command` 只在这里就地
 *    分类成 building / testing / syncing 之一，发出去的是**类别**不是命令。
 *    这比「发出去再脱敏」强一个量级——原文根本不过边界。
 *
 * 3. **Maclawd 没开时静默退出。** 连不上就当无事发生，退出码 0。
 *    桌宠没开不该在用户的 agent 里留下任何错误。
 *
 * 同理，`Stop` 的「是否真的完成」也在这里就地判定：读一次 transcript 尾部，
 * 发出去的是一个枚举，**transcript 路径本身不越界**（它含编码过的项目目录）。
 */
import { readStopDisposition } from '../src/runtime/stop-disposition.js';
import { discoverPort } from '../src/runtime/endpoint.js';
import { dropLease, writeLease } from '../src/runtime/session-lease.js';
import { autoStart } from '../src/runtime/auto-start.js';
import { loadSettings } from '../src/runtime/settings.js';

const STDIN_TIMEOUT_MS = 800;
const POST_TIMEOUT_MS = 700;
const WORKBUDDY_POST_TIMEOUT_MS = 100;
const MAX_STDIN_BYTES = 1 << 20; // 1 MiB，超过就只用已读到的部分

function exitQuietly() {
  // 任何失败都必须是静默的：hook 的错误会污染 agent 的输出。
  process.exit(0);
}

/** 与 src/runtime/state-engine.js 的 classifyBash 保持同一套判据。 */
const BASH_PATTERNS = [
  [/\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|jest|vitest)\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b/, 'working.testing'],
  [/\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?build\b|\bmake\b|\bcargo\s+build\b|\bgo\s+build\b|\btsc\b|\bwebpack\b|\bvite\s+build\b/, 'working.building'],
];

function classifyCommand(command) {
  if (typeof command !== 'string' || !command) return 'working';
  for (const [pattern, action] of BASH_PATTERNS) {
    if (pattern.test(command)) return action;
  }
  return 'working';
}

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

/**
 * 从 hook 载荷里只挑桌宠需要的元数据。
 *
 * 白名单而非黑名单：新版本 Claude Code 往载荷里加什么字段都不会意外泄出去。
 */
function buildEvent(eventName, payload, sourceAgent = 'claude-code') {
  const event = {
    type: eventName,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : 'default',
    agentId: sourceAgent,
    channel: 'hook',
  };

  const toolName = payload.tool_name;
  if (typeof toolName === 'string' && toolName) event.toolName = toolName;

  // 只有 Bash 需要看命令，而且只看一眼就丢。
  if (toolName === 'Bash') {
    const command = payload.tool_input && payload.tool_input.command;
    event.commandClass = classifyCommand(command);
  }

  if (typeof payload.agent_id === 'string') event.subagentId = payload.agent_id;
  if (typeof payload.agent_type === 'string') event.agentType = payload.agent_type;

  // **谁发起的这次请求。** 有了它，桌宠才能从「提醒你有事」变成「点我带你过去」——
  // needs_owner 亮着的时候，点一下就跳回那个正等着你回答的终端窗口。
  //
  // process.ppid 是拉起这个 hook 的进程，也就是 agent 本身。外壳拿到之后
  // 沿父进程链往上走，直到撞见一个真正的应用进程（终端）——那一步在 Swift 里
  // 用 sysctl 做，不需要在这条热路径上 spawn 一个 ps。
  if (Number.isInteger(process.ppid) && process.ppid > 1) event.pid = process.ppid;
  // cwd 用来在面板上说清「哪个项目」。它是本机路径，与全程本地的原则一致；
  // 命令原文仍然一步都不外传。
  if (typeof payload.cwd === 'string' && payload.cwd) event.cwd = payload.cwd;

  // Notification / StopFailure 的 matcher 决定 variant（permission / rate_limit …），
  // 是枚举值不是自由文本，可以安全传递。
  const matcher = payload.matcher ?? payload.notification_type ?? payload.reason;
  if (typeof matcher === 'string' && /^[a-z_]{1,40}$/.test(matcher)) event.matcher = matcher;

  return event;
}

async function post(port, body, timeoutMs = POST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    await fetch(`http://127.0.0.1:${port}/api/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Maclawd 没开或正在重启——静默。
  } finally {
    clearTimeout(timer);
  }
}

async function enrich(eventName, payload, event) {
  // 只有 Stop 需要判定；其余事件不该为此付出一次文件读取。
  if (eventName !== 'Stop') return;
  event.disposition = await readStopDisposition(payload.transcript_path);

  // **Stop 不等于回合结束。** 三种情况下 Claude 收到 Stop 之后还会继续跑：
  //
  //   · stop_hook_active —— 有 Stop hook 否决了这次停止。这不是边角情况：
  //     `/goal` 装的就是 Stop hook，一个任务里能触发好几轮。每一轮桌宠
  //     都会「working → idle + 欢呼 → working」，为一件没做完的事欢呼。
  //   · session_crons  —— 定时唤醒还挂着，一会儿自己会醒
  //   · background_tasks —— 后台 shell 还在跑（Bash 的 run_in_background）
  //
  // 只送**计数与布尔**，绝不送任务描述或命令原文——与本文件第 2 条硬约束一致。
  if (payload.stop_hook_active === true) event.stopHookActive = true;
  if (Array.isArray(payload.background_tasks) && payload.background_tasks.length > 0) {
    event.backgroundTasks = payload.background_tasks.length;
  }
  if (Array.isArray(payload.session_crons) && payload.session_crons.length > 0) {
    event.sessionCrons = payload.session_crons.length;
  }
}

async function main() {
  const eventName = process.argv[2];
  if (!eventName) exitQuietly();
  const sourceAgent = process.argv[3] === '--maclawd-source=workbuddy'
    ? 'workbuddy' : 'claude-code';

  // 端口来自运行时写的端点文件，不再写死——4173 撞上 Vite preview 的概率不低。
  const port = discoverPort();
  const raw = await readStdin();

  let payload = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      // 载荷坏了也照样把事件类型报上去——状态机不需要细节也能推进。
      payload = {};
    }
  }

  // WorkBuddy 的 command hook 会解析 stdout 作为决策结果。状态通道必须立即
  // 返回空对象，表示完全不介入它的原生工具与权限流程；空 stdout 会被记为错误。
  if (sourceAgent === 'workbuddy') process.stdout.write('{}\n');

  // 没有真实会话 id 的 WorkBuddy 事件无法归属。用 "default" 上报会造出一个
  // 后续事件永远清不掉的幽灵会话，因此只回答 Hook，不进入 Maclawd。
  if (sourceAgent === 'workbuddy') {
    const sessionId = payload.session_id == null ? '' : String(payload.session_id).trim();
    if (!sessionId) return;
    payload.session_id = sessionId;
  }

  // 开 agent 却没开桌宠是常态。只在会话开始时探一次——这条路要读设置、
  // 查端点文件，不该出现在每个 PreToolUse 上。
  if (eventName === 'SessionStart') {
    try {
      autoStart({ enabled: loadSettings().autoStart !== false });
    } catch {
      // 拉不起来就算了，事件照常往下走
    }
  }

  const event = buildEvent(eventName, payload, sourceAgent);
  await enrich(eventName, payload, event);
  // 租约先写、再 POST。顺序是刻意的：**写租约不依赖服务在线**，
  // 而这正是它存在的理由——桌宠没开的时候，这是唯一留下的痕迹。
  recordLease(eventName, event);
  await post(port, event, sourceAgent === 'workbuddy' ? WORKBUDDY_POST_TIMEOUT_MS : POST_TIMEOUT_MS);
  process.exitCode = 0;
}

/**
 * 把「这个会话正在干什么」落到磁盘。
 *
 * 之前桌宠没开时事件是直接丢掉的，于是「先开 Claude Code 后开 Maclawd」
 * 与「重新打包重启一次」这两件事的结果都是：桌宠从 idle 开始，
 * 而屏幕另一头的任务还在跑。
 */
function recordLease(eventName, event) {
  try {
    // 会话结束了就把租约撤掉，别让下次启动复活一个已经没了的会话
    if (eventName === 'SessionEnd') {
      dropLease(event.sessionId, event.agentId);
      return;
    }
    const state = LEASE_STATES[eventName] === 'byCommand'
      ? (event.commandClass ?? 'working')
      : LEASE_STATES[eventName];
    if (!state) return;
    writeLease({
      sessionId: event.sessionId, state, pid: event.pid, cwd: event.cwd, agentId: event.agentId,
    });
  } catch {
    // 租约是尽力而为：写不成也绝不能影响 agent
  }
}

/**
 * 哪些事件值得留下租约。
 *
 * Stop 刻意不在里面——它意味着这一轮结束了，恢复它没有意义。
 * 而被 Stop 门按住的那种「其实还在跑」的 Stop，前面必然有过
 * PreToolUse/PostToolUse，那份租约还在，不需要 Stop 再写一次。
 */
const LEASE_STATES = {
  UserPromptSubmit: 'thinking',
  SessionStart: 'thinking',
  PreToolUse: 'byCommand',
  PostToolUse: 'working',
  PostToolBatch: 'working',
  PostToolUseFailure: 'working.retrying',
  SubagentStart: 'delegating',
  SubagentStop: 'working',
  PreCompact: 'compacting',
  PostCompact: 'working',
};

// 顶层异常同样必须静默。
main().catch(exitQuietly);
