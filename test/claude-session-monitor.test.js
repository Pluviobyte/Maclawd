import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeJsonlEvent, createClaudeSessionMonitor } from '../src/runtime/claude-session-monitor.js';

/**
 * Claude Code 的 JSONL 兜底通道。
 *
 * 存在的理由是一个可见性缺口：hook 开关默认关闭，而在补上这条路之前，
 * Claude Code 在实时会话里**完全不出现**（Codex 却出现，因为它早就有兜底）。
 * 用户看到的是「我明明开着 Claude Code，面板却空着」，没有任何线索。
 */

const user = (extra = {}) => ({
  type: 'user',
  sessionId: 's1',
  cwd: '/w',
  message: { role: 'user', content: '帮我看下这个 bug' },
  ...extra,
});
const assistant = (content, extra = {}) => ({
  type: 'assistant',
  sessionId: 's1',
  cwd: '/w',
  message: { role: 'assistant', content },
  ...extra,
});

test('真人输入 → thinking；工具调用 → 带工具名的 PreToolUse', () => {
  assert.deepEqual(claudeJsonlEvent(user()), {
    sessionId: 's1', agentId: 'claude-code', channel: 'jsonl', cwd: '/w', type: 'UserPromptSubmit',
  });
  assert.deepEqual(claudeJsonlEvent(assistant([{ type: 'tool_use', name: 'Read', input: {} }])), {
    sessionId: 's1', agentId: 'claude-code', channel: 'jsonl', cwd: '/w',
    type: 'PreToolUse', toolName: 'Read',
  });
});

test('Bash 命令就地分类成类别，原文一个字都不进事件', () => {
  // 与 hooks/maclawd-hook.js 同一条红线：命令原文不过边界。
  const event = claudeJsonlEvent(assistant([
    { type: 'tool_use', name: 'Bash', input: { command: 'npm test -- --grep secret-token' } },
  ]));
  assert.equal(event.commandClass, 'working.testing');
  assert.equal(JSON.stringify(event).includes('secret-token'), false,
    '命令原文绝不能出现在事件里');
});

test('工具结果回填算 PostToolUse，不算用户又说了一句话', () => {
  const row = user({ message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
  assert.equal(claudeJsonlEvent(row).type, 'PostToolUse');
});

test('只有正文、没有工具调用 = 这一轮讲完了', () => {
  assert.equal(claudeJsonlEvent(assistant([{ type: 'text', text: '改好了' }])).type, 'Stop');
  // thinking-only 既不改变状态也不结束回合，报上去只会白刷时间戳
  assert.equal(claudeJsonlEvent(assistant([{ type: 'thinking', thinking: '让我想想' }])), null);
  // 空正文不算说过话
  assert.equal(claudeJsonlEvent(assistant([{ type: 'text', text: '  ' }])), null);
  // 正文 + 工具调用同在一条消息里时，工具调用优先——回合没结束
  assert.equal(claudeJsonlEvent(assistant([
    { type: 'text', text: '我先读一下' }, { type: 'tool_use', name: 'Read', input: {} },
  ])).type, 'PreToolUse');
});

test('subagent 的记录可以让父会话保持在忙，但绝不能替它结束回合', () => {
  // 子链与父会话共用 sessionId：让 subagent 的最后一句话结束父会话的回合，
  // 会在任务只做了一半时演完成庆祝。
  assert.equal(claudeJsonlEvent(assistant([{ type: 'text', text: '子任务完成' }],
    { isSidechain: true })), null);
  assert.equal(claudeJsonlEvent(assistant([{ type: 'tool_use', name: 'Grep', input: {} }],
    { isSidechain: true })).type, 'PreToolUse', '子链的工具调用仍说明父会话在忙');
  assert.equal(claudeJsonlEvent(user({ isSidechain: true })), null);
});

test('meta 行与无会话 id 的行一律不报', () => {
  assert.equal(claudeJsonlEvent(user({ isMeta: true })), null);
  assert.equal(claudeJsonlEvent(user({ sessionId: undefined })), null,
    '没有会话 id 会造出一个永远清不掉的幽灵会话');
  assert.equal(claudeJsonlEvent({ type: 'mode', mode: 'plan' }), null);
  assert.equal(claudeJsonlEvent({ type: 'file-history-snapshot' }), null);
});

test('WorkBuddy 同格式，只是归属不同', () => {
  assert.equal(claudeJsonlEvent(user(), {}, 'workbuddy').agentId, 'workbuddy');
});

test('首见的文件不回放历史，之后的追加才产生事件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-claude-live-'));
  const project = join(root, '-Users-x-proj');
  mkdirSync(project, { recursive: true });
  const file = join(project, 's1.jsonl');
  // 已经存在的历史：一次完整的问答。启动时回放它会炸出假的完成庆祝。
  writeFileSync(file, `${[
    JSON.stringify(user()),
    JSON.stringify(assistant([{ type: 'text', text: '好了' }])),
  ].join('\n')}\n`);

  const events = [];
  const stop = createClaudeSessionMonitor({
    roots: () => [root], onEvent: (event) => events.push(event), intervalMs: 20,
  });
  try {
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    assert.deepEqual(events, [], '首见的文件一个事件都不该发');

    appendFileSync(file, `${JSON.stringify(assistant([
      { type: 'tool_use', name: 'Edit', input: {} },
    ]))}\n`);
    await new Promise((resolve) => { setTimeout(resolve, 120); });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'PreToolUse');
    assert.equal(events[0].sessionId, 's1');
    assert.equal(events[0].cwd, '/w');
  } finally { stop(); }
});

test('半行留到下一轮，不因为写到一半就丢事件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-claude-partial-'));
  mkdirSync(join(root, 'p'), { recursive: true });
  const file = join(root, 'p', 's1.jsonl');
  writeFileSync(file, `${JSON.stringify(user({ isMeta: true }))}\n`);

  const events = [];
  const stop = createClaudeSessionMonitor({
    roots: () => [root], onEvent: (event) => events.push(event), intervalMs: 20,
  });
  try {
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    const line = JSON.stringify(assistant([{ type: 'tool_use', name: 'Write', input: {} }]));
    appendFileSync(file, line.slice(0, 20)); // agent 正写到一半
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    assert.deepEqual(events, [], '残缺的行不该被当成事件');
    appendFileSync(file, `${line.slice(20)}\n`); // 写完了
    await new Promise((resolve) => { setTimeout(resolve, 120); });
    assert.equal(events.length, 1, '补齐之后必须补上那个事件');
    assert.equal(events[0].toolName, 'Write');
  } finally { stop(); }
});
