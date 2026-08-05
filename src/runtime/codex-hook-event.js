import { classifyBash } from './state-engine.js';

/** Convert Codex's hook stdin into the small, privacy-safe event Maclawd needs. */
export function buildCodexEvent(eventName, payload = {}, { pid = process.ppid } = {}) {
  const event = {
    type: eventName,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : 'default',
    agentId: 'codex',
    channel: 'hook',
  };
  if (Number.isInteger(pid) && pid > 1) event.pid = pid;
  if (typeof payload.cwd === 'string' && payload.cwd) event.cwd = payload.cwd;
  if (typeof payload.tool_name === 'string') event.toolName = payload.tool_name;
  if (event.toolName === 'Bash') {
    event.commandClass = classifyBash(payload.tool_input?.command);
  }
  if (typeof payload.agent_id === 'string') event.subagentId = payload.agent_id;
  if (eventName === 'Stop' && payload.reason === 'interrupted') event.disposition = 'interrupted';
  return event;
}
