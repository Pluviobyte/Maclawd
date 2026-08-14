import { getProjectDirs } from './claude-roots.js';
import { projectsDir as workBuddyProjectsDir } from './parsers/workbuddy.js';
import { createJsonlSessionMonitor } from './jsonl-session-monitor.js';

/**
 * Claude Code（及其同格式分支 WorkBuddy）的 transcript JSONL → 引擎事件。
 *
 * 补上 Codex 早就有、而这里一直缺的那条兜底通道。缺它的后果不是「少一点
 * 信息」而是**整个 agent 从实时会话里消失**：hook 开关默认关闭，于是新用户
 * 装上之后看到的是「Codex 有会话、Claude Code 一片空白」，没有任何线索说明
 * 为什么——而 transcript 就在 ~/.claude/projects 里持续写着。
 *
 * **和 hook 通道的分工要说清楚。** hook 是权威：它带 pid（点击跳回终端要用）、
 * 带权限请求、带 compact，而且事件在发生的瞬间到达。JSONL 只能看见「已经被
 * 写进文件的东西」，拿不到 pid，也看不见权限提示。所以这条路的定位是
 * **尽力而为的可见性**，不是 hook 的替代品；server.js 里 hook 一活跃就让位。
 *
 * 映射只取高置信度的形状：
 *
 *   · 真人输入（user 行、content 是字符串、非 meta）      → UserPromptSubmit
 *   · assistant 行里的 tool_use                          → PreToolUse（带工具名）
 *   · user 行里的 tool_result                            → PostToolUse
 *   · assistant 行只有正文、没有 tool_use                 → Stop（这一轮说完了）
 *
 * thinking-only 的 assistant 行**刻意不报**：它既不改变状态也不结束回合，
 * 报上去只会让 s.at 无谓地刷新。
 */

/** 与 hooks/maclawd-hook.js 的 classifyCommand 保持同一套判据。 */
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

const blocks = (row) => (Array.isArray(row?.message?.content) ? row.message.content : []);

export function claudeJsonlEvent(row, context = {}, agentId = 'claude-code') {
  const type = row?.type;
  if (type !== 'user' && type !== 'assistant') return null;

  const sessionId = row.sessionId ?? context.sessionId;
  // 没有会话 id 就没法归属。用 'default' 顶上会造出一个永远清不掉的幽灵会话
  // （与 hook 写入器对 WorkBuddy 的处理同一个道理）。
  if (!sessionId) return null;

  const base = {
    sessionId, agentId, channel: 'jsonl', cwd: row.cwd ?? context.cwd,
  };

  // 子链是 subagent 的记录，它和父会话共用 sessionId。可以让父会话保持
  // 「在忙」，但**绝不能让它结束父会话的回合**——subagent 说完最后一句话时，
  // 父会话通常还有一大半没做完。
  const sidechain = row.isSidechain === true;

  if (type === 'assistant') {
    const tool = blocks(row).find((b) => b?.type === 'tool_use');
    if (tool) {
      const event = { ...base, type: 'PreToolUse', toolName: tool.name ?? 'Tool' };
      // 命令原文只在本进程里就地分类，不进事件——与 hook 写入器同一条红线。
      if (tool.name === 'Bash') event.commandClass = classifyCommand(tool.input?.command);
      return event;
    }
    if (sidechain) return null;
    const spoke = blocks(row).some((b) => b?.type === 'text' && String(b.text ?? '').trim());
    // 只有正文、没有工具调用 = 这一轮讲完了。JSONL 里没有比这更硬的回合终点，
    // 而 hook 通道有真正的 Stop，所以这里的粗糙只影响兜底模式。
    return spoke ? { ...base, type: 'Stop', disposition: 'complete' } : null;
  }

  // user 行有两副面孔：真人输入，和工具结果回填。
  if (blocks(row).some((b) => b?.type === 'tool_result')) {
    return { ...base, type: 'PostToolUse' };
  }
  if (sidechain || row.isMeta === true) return null;
  const typed = typeof row.message?.content === 'string' && row.message.content.trim();
  return typed ? { ...base, type: 'UserPromptSubmit' } : null;
}

/** 身份写在每一行上，取到一次就够——首见读文件头时用它认领会话。 */
function learnClaudeContext(row, context) {
  if (row?.type !== 'user' && row?.type !== 'assistant') return context;
  return {
    sessionId: row.sessionId ?? context.sessionId,
    cwd: row.cwd ?? context.cwd,
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.agentId] 'claude-code' 或 'workbuddy'——两者 transcript
 *                                同格式，只有目录和归属不同。
 */
export function createClaudeSessionMonitor({
  agentId = 'claude-code',
  roots = agentId === 'workbuddy' ? () => [workBuddyProjectsDir()] : getProjectDirs,
  ...options
} = {}) {
  return createJsonlSessionMonitor({
    roots,
    toEvent: (row, context) => claudeJsonlEvent(row, context, agentId),
    learnContext: learnClaudeContext,
    ...options,
  });
}
