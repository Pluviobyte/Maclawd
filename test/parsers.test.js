import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as claudeCode from '../src/runtime/parsers/claude-code.js';
import * as workbuddy from '../src/runtime/parsers/workbuddy.js';
import { billable, throughput } from '../src/runtime/usage-record.js';

// ---------- Claude Code ----------

test('Claude Code：只认 type=assistant 且带 usage 的行', () => {
  assert.equal(claudeCode.parseObject({ type: 'user', timestamp: '2026-07-30T10:00:00Z' }), null);
  assert.equal(claudeCode.parseObject({ type: 'assistant', timestamp: '2026-07-30T10:00:00Z' }), null);
  assert.equal(claudeCode.parseObject({ type: 'assistant', message: { usage: {} } }), null);
});

test('Claude Code：三类输入互斥，不做 inclusive 减法', () => {
  const record = claudeCode.parseObject({
    type: 'assistant',
    timestamp: '2026-07-30T10:00:00Z',
    cwd: '/Users/rain/Desktop/Maclawd',
    uuid: 'u1',
    requestId: 'r1',
    message: {
      id: 'm1',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 300,
      },
    },
  });
  assert.equal(record.input, 100, 'input 原样保留');
  assert.equal(record.cacheRead, 9000);
  assert.equal(record.write5m, 300);
  assert.equal(billable(record), 450);
  assert.equal(throughput(record), 9450);
  assert.equal(record.model, 'claude-opus-5');
  assert.equal(record.messageId, 'm1');
  assert.equal(record.source, 'claude-code');
});

test('Claude Code：<synthetic> 保留为独立模型，不向前结转', () => {
  const record = claudeCode.parseObject({
    type: 'assistant',
    timestamp: '2026-07-30T10:00:00Z',
    message: { model: '<synthetic>', usage: { input_tokens: 1, output_tokens: 1 } },
  });
  assert.equal(record.model, '<synthetic>');
});

test('Claude Code：坏时间戳直接丢弃', () => {
  assert.equal(claudeCode.parseObject({
    type: 'assistant',
    timestamp: 'not-a-date',
    message: { usage: { input_tokens: 1 } },
  }), null);
});

test('Claude Code：projectFromCwd 兼容 Windows 路径', () => {
  assert.equal(claudeCode.projectFromCwd('/Users/rain/Desktop/Maclawd'), 'Maclawd');
  assert.equal(claudeCode.projectFromCwd('C:\\Users\\rain\\Maclawd\\'), 'Maclawd');
  assert.equal(claudeCode.projectFromCwd(''), null);
});

// ---------- WorkBuddy ----------

/** 取自 ~/.workbuddy/projects 的真实记录结构。 */
function workbuddyRecord(timestamp) {
  return {
    type: 'function_call',
    id: 'gen-1784799112-abc',
    cwd: '/Users/rain/Workbuddy',
    timestamp,
    message: {
      usage: {
        input_tokens: 35908,
        output_tokens: 1990,
        total_tokens: 37898,
        cache_read_input_tokens: 30848,
      },
    },
    providerData: {
      messageId: 'd4f7f4bebcd2',
      model: 'hy3',
      requestModelId: 'hy3',
      requestModelName: 'Hy3',
      conversationRequestId: 'ff385f99',
      rawUsage: {
        prompt_tokens: 35908,
        completion_tokens: 1990,
        total_tokens: 37898,
        completion_tokens_details: { reasoning_tokens: 1718 },
        prompt_tokens_details: { cached_tokens: 30848 },
      },
    },
  };
}

test('WorkBuddy：usage 挂在 function_call 上，不按 type 过滤', () => {
  const record = workbuddy.parseObject(workbuddyRecord('2026-07-23T17:31:51Z'));
  assert.ok(record, 'function_call 记录必须被接受');
  assert.equal(record.source, 'workbuddy');
});

test('WorkBuddy：input 含缓存，必须减掉（不变量 1）', () => {
  const record = workbuddy.parseObject(workbuddyRecord('2026-07-23T17:31:51Z'));
  assert.equal(record.input, 5060, '35908 - 30848');
  assert.equal(record.cacheRead, 30848);
  assert.equal(record.output, 1990);
  // 不减掉的话 throughput 会把 30848 重复计一遍
  assert.equal(throughput(record), 5060 + 1990 + 30848);
});

test('WorkBuddy：reasoning 是 output 的子集（不变量 2）', () => {
  const record = workbuddy.parseObject(workbuddyRecord('2026-07-23T17:31:51Z'));
  assert.equal(record.reasoning, 1718);
  assert.ok(record.reasoning <= record.output, 'reasoning 不得超过 output');
  // billable 里 reasoning 不额外加一遍
  assert.equal(billable(record), 5060 + 1990);
});

test('WorkBuddy：用 providerData.messageId 而非顶层 id 做去重键', () => {
  const record = workbuddy.parseObject(workbuddyRecord('2026-07-23T17:31:51Z'));
  assert.equal(record.messageId, 'd4f7f4bebcd2');
  assert.notEqual(record.messageId, 'gen-1784799112-abc');
});

test('WorkBuddy：模型名优先取 requestModelName', () => {
  const record = workbuddy.parseObject(workbuddyRecord('2026-07-23T17:31:51Z'));
  assert.equal(record.model, 'Hy3');
});

test('WorkBuddy：时间戳兼容 ISO / epoch 秒 / epoch 毫秒', () => {
  const iso = workbuddy.parseObject(workbuddyRecord('2026-07-23T17:31:51Z'));
  const seconds = workbuddy.parseObject(workbuddyRecord(1_784_799_111));
  const millis = workbuddy.parseObject(workbuddyRecord(1_784_799_111_000));
  assert.ok(iso.ts > 0);
  assert.equal(seconds.ts, millis.ts, 'epoch 秒与毫秒必须归一到同一时刻');
});

test('WorkBuddy：没有可用 usage 时返回 null', () => {
  assert.equal(workbuddy.parseObject({ type: 'reasoning', timestamp: 1 }), null);
  assert.equal(workbuddy.parseObject({
    type: 'function_call', timestamp: 1, message: { usage: {} },
  }), null);
});
