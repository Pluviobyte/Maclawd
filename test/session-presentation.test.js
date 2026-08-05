import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionAgentLabel, sessionStateLabel, sessionStatePriority,
} from '../src/runtime/session-presentation.js';

test('实时会话使用用户熟悉的 Agent 名称', () => {
  assert.equal(sessionAgentLabel('codex', 'Codex CLI'), 'Codex');
  assert.equal(sessionAgentLabel('claude-code', 'Claude Code'), 'Claude Code');
  assert.equal(sessionAgentLabel('future-agent'), '其他 Agent');
});

test('实时会话显示 agent 状态，不显示桌宠动画名', () => {
  assert.equal(sessionStateLabel('thinking'), '思考中');
  assert.equal(sessionStateLabel('idle'), '等待中');
  assert.equal(sessionStateLabel('working.testing'), '测试中');
  assert.equal(sessionStateLabel('compacting'), '整理上下文');
});

test('需要用户介入时按原因给出具体提示', () => {
  assert.equal(sessionStateLabel('needs_owner', 'permission'), '等待你批准');
  assert.equal(sessionStateLabel('needs_owner', 'question'), '等待你回复');
  assert.equal(sessionStateLabel('needs_owner', 'unknown'), '需要你处理');
});

test('未知状态使用稳定且不暴露内部 id 的兜底文案', () => {
  assert.equal(sessionStateLabel('future.internal_state'), '运行中');
});

test('会话排序先关注介入与错误，再排工作、思考和等待', () => {
  assert.equal(sessionStatePriority('needs_owner'), 0);
  assert.equal(sessionStatePriority('error'), 0);
  assert.equal(sessionStatePriority('working.testing'), 1);
  assert.equal(sessionStatePriority('thinking'), 2);
  assert.equal(sessionStatePriority('idle'), 3);
  assert.equal(sessionStatePriority('future.internal_state'), 4);
});
