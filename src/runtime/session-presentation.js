/**
 * 实时会话面向用户的状态文案。
 *
 * 动作名（Puzzle Turn、Quiet Watch 等）描述桌宠怎么演，不描述 agent
 * 在做什么。会话面板回答的是后一个问题，因此不能直接复用动作合同里的名称。
 */
const SESSION_STATE_LABELS = {
  idle: '等待中',
  thinking: '思考中',
  working: '工作中',
  'working.building': '构建中',
  'working.testing': '测试中',
  'working.retrying': '重试中',
  'working.long': '持续工作中',
  delegating: '调用子代理',
  waiting: '等待协作结果',
  compacting: '整理上下文',
  error: '运行出错',
};

export function sessionAgentLabel(agentId, sourceLabel = null) {
  if (agentId === 'codex') return 'Codex';
  return sourceLabel || '其他 Agent';
}

export function sessionStateLabel(state, variant = null) {
  if (state === 'needs_owner') {
    if (variant === 'permission') return '等待你批准';
    if (variant === 'question') return '等待你回复';
    return '需要你处理';
  }
  return SESSION_STATE_LABELS[state] ?? '运行中';
}

/** 数字越小，越应该排在会话页前面。 */
export function sessionStatePriority(state) {
  if (state === 'needs_owner' || state === 'error') return 0;
  if (state === 'working' || String(state).startsWith('working.')) return 1;
  if (state === 'thinking' || state === 'delegating' || state === 'compacting') return 2;
  if (state === 'waiting' || state === 'idle') return 3;
  return 4;
}
