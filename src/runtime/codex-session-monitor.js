import { sessionDirs } from './parsers/codex.js';
import { createJsonlSessionMonitor } from './jsonl-session-monitor.js';

/**
 * Codex rollout JSONL → 引擎事件。
 *
 * 只映射**高置信度的生命周期形状**，别的一律返回 null：官方 hook 才是权威
 * 通道，这条路是它没开时的兜底，宁可少报也不要报错。
 * 尾随机制（偏移、半行、轮转、首见不回放）在 jsonl-session-monitor.js 里。
 */
export function codexJsonlEvent(row, context = {}) {
  const payload = row?.payload ?? {};
  const type = row?.type;
  const base = {
    sessionId: context.sessionId ?? 'default', agentId: 'codex', channel: 'jsonl',
    cwd: context.cwd,
  };
  if (type === 'session_meta') {
    return { ...base, type: 'SessionStart', sessionId: payload.id ?? base.sessionId, cwd: payload.cwd };
  }
  if (type === 'turn_context') return { ...base, type: 'UserPromptSubmit', cwd: payload.cwd ?? base.cwd };
  if (type === 'event_msg') {
    if (['task_started', 'turn_started'].includes(payload.type)) return { ...base, type: 'UserPromptSubmit' };
    if (['task_complete', 'turn_complete', 'turn_completed'].includes(payload.type)) {
      return { ...base, type: 'Stop', disposition: 'complete' };
    }
    if (['turn_aborted', 'task_aborted'].includes(payload.type)) {
      return { ...base, type: 'Stop', disposition: 'interrupted' };
    }
  }
  if (type === 'response_item') {
    const toolTypes = new Set(['function_call', 'custom_tool_call', 'local_shell_call']);
    if (toolTypes.has(payload.type)) {
      const name = payload.name ?? (payload.type === 'local_shell_call' ? 'Bash' : 'Tool');
      return { ...base, type: 'PreToolUse', toolName: name };
    }
  }
  return null;
}

/** Codex 把身份写在 rollout 头部的 session_meta 里，之后由 turn_context 更新 cwd。 */
function learnCodexContext(row, context) {
  if (row?.type === 'session_meta') {
    return { sessionId: row.payload?.id, cwd: row.payload?.cwd };
  }
  if (row?.type === 'turn_context' && row.payload?.cwd) {
    return { ...context, cwd: row.payload.cwd };
  }
  return context;
}

export function createCodexSessionMonitor(options = {}) {
  return createJsonlSessionMonitor({
    // 只跟活跃目录；archived_sessions 里的东西按定义已经结束了。
    // 但仍然监听它，因为归档是「移动文件」，会连带触发活跃目录的变化。
    roots: () => sessionDirs().slice(0, 1),
    watchRoots: sessionDirs,
    toEvent: codexJsonlEvent,
    learnContext: learnCodexContext,
    ...options,
  });
}
