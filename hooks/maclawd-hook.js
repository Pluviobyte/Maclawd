#!/usr/bin/env node
/**
 * Maclawd 的 Claude Code hook 写入器。
 *
 * 用法（由 `maclawd-usage hook install` 写进 ~/.claude/settings.json）：
 *   node <repo>/hooks/maclawd-hook.js <EventName>
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

const STDIN_TIMEOUT_MS = 800;
const POST_TIMEOUT_MS = 700;
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
function buildEvent(eventName, payload) {
  const event = {
    type: eventName,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : 'default',
  };

  const toolName = payload.tool_name;
  if (typeof toolName === 'string' && toolName) event.toolName = toolName;

  // 只有 Bash 需要看命令，而且只看一眼就丢。
  if (toolName === 'Bash') {
    const command = payload.tool_input && payload.tool_input.command;
    event.commandClass = classifyCommand(command);
  }

  if (typeof payload.agent_id === 'string') event.agentId = payload.agent_id;
  if (typeof payload.agent_type === 'string') event.agentType = payload.agent_type;

  // Notification / StopFailure 的 matcher 决定 variant（permission / rate_limit …），
  // 是枚举值不是自由文本，可以安全传递。
  const matcher = payload.matcher ?? payload.notification_type ?? payload.reason;
  if (typeof matcher === 'string' && /^[a-z_]{1,40}$/.test(matcher)) event.matcher = matcher;

  return event;
}

async function post(port, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
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
}

async function main() {
  const eventName = process.argv[2];
  if (!eventName) exitQuietly();

  const port = Number(process.env.MACLAWD_PORT) || 4173;
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

  const event = buildEvent(eventName, payload);
  await enrich(eventName, payload, event);
  await post(port, event);
  exitQuietly();
}

// 顶层异常同样必须静默。
main().catch(exitQuietly);
