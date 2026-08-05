import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maclawd-perm-'));
process.env.MACLAWD_DATA_DIR = join(root, 'data');

const { createPermissionBroker, decisionResponse } = await import('../src/runtime/permissions.js');
const {
  authorize, currentToken, isLoopback, resetToken, rotateToken, tokenValid,
} = await import('../src/runtime/lan.js');

after(() => rmSync(root, { recursive: true, force: true }));

// ---------- 权限通道 ----------

test('允许 / 拒绝分别翻译成 Claude Code 的决策形态', () => {
  assert.equal(decisionResponse('allow').hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(decisionResponse('deny').hookSpecificOutput.permissionDecision, 'deny');
});

test('沉默必须等于不干预——这是整条通道最重要的一条', () => {
  // 超时、通道关闭、Maclawd 重启……一律返回空对象，
  // 让 Claude Code 继续走它自己的确认流程，绝不替用户做主。
  assert.deepEqual(decisionResponse(null), {});
  assert.deepEqual(decisionResponse(undefined), {});
  assert.deepEqual(decisionResponse('乱写'), {});
});

test('Codex 权限返回体使用官方 decision.behavior 协议', () => {
  assert.deepEqual(decisionResponse('allow', 'codex'), {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
  assert.deepEqual(decisionResponse(null, 'codex'), {});
});

test('用户点允许后，等待中的请求拿到决策', async () => {
  const broker = createPermissionBroker({ timeoutMs: 5000 });
  const pending = broker.request({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
  const [entry] = broker.list();
  assert.equal(entry.tool, 'Bash');
  assert.equal(broker.decide(entry.id, 'allow'), true);
  assert.equal(await pending, 'allow');
  assert.equal(broker.size, 0, '决策后必须从等待队列移除');
});

test('超时返回 null 而不是自动允许或自动拒绝', async () => {
  const broker = createPermissionBroker({ timeoutMs: 30 });
  const decision = await broker.request({ session_id: 's1', tool_name: 'Bash' });
  assert.equal(decision, null);
  assert.equal(broker.size, 0);
});

test('展示摘要必须脱敏——工具入参可能带密钥', async () => {
  const broker = createPermissionBroker({ timeoutMs: 5000 });
  broker.request({
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command: 'curl -H "Authorization: Bearer ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' },
  });
  const [entry] = broker.list();
  assert.ok(!entry.detail.includes('ghp_'), `摘要泄露了密钥: ${entry.detail}`);
  broker.releaseAll();
});

test('无害命令的摘要正常显示，不会一律清空', async () => {
  const broker = createPermissionBroker({ timeoutMs: 5000 });
  broker.request({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm run build' } });
  assert.equal(broker.list()[0].detail, 'npm run build');
  broker.releaseAll();
});

test('不保留原始载荷，只留可展示的摘要字段', async () => {
  const broker = createPermissionBroker({ timeoutMs: 5000 });
  broker.request({ session_id: 's1', tool_name: 'Read', tool_input: { file_path: '/x' }, secret_field: '不该出现' });
  const entry = broker.list()[0];
  assert.deepEqual(Object.keys(entry).sort(), [
    'agentId', 'agentLabel', 'at', 'detail', 'expiresAt', 'id', 'project', 'sessionId', 'tool',
  ]);
  broker.releaseAll();
});

test('对未知 id 或非法决策的调用是安全的', () => {
  const broker = createPermissionBroker();
  assert.equal(broker.decide('不存在', 'allow'), false);
});

test('releaseAll 把全部等待请求交回，不留悬挂', async () => {
  const broker = createPermissionBroker({ timeoutMs: 60_000 });
  const a = broker.request({ tool_name: 'Bash' });
  const b = broker.request({ tool_name: 'Read' });
  broker.releaseAll();
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
});

// ---------- 局域网门禁 ----------

test('本机永远放行且可写', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.ok(isLoopback(address), address);
    const gate = authorize({ remoteAddress: address, pathname: '/api/settings', method: 'POST', lanEnabled: false });
    assert.equal(gate.allow, true);
    assert.equal(gate.readOnly, false);
  }
});

test('未开启局域网镜像时，外部地址一律拒绝', () => {
  const gate = authorize({
    remoteAddress: '192.168.1.20', pathname: '/api/state', method: 'GET',
    token: currentToken(), lanEnabled: false,
  });
  assert.equal(gate.allow, false);
  assert.match(gate.reason, /未开启/);
});

test('开启后仍需正确令牌', () => {
  const base = { remoteAddress: '192.168.1.20', pathname: '/api/state', method: 'GET', lanEnabled: true };
  assert.equal(authorize({ ...base, token: 'wrong' }).allow, false);
  assert.equal(authorize({ ...base, token: undefined }).allow, false);
  assert.equal(authorize({ ...base, token: currentToken() }).allow, true);
});

test('局域网连接严格只读', () => {
  const base = { remoteAddress: '192.168.1.20', lanEnabled: true, token: currentToken() };
  // 写操作一律拒绝
  for (const path of ['/api/settings', '/api/scan', '/api/reset', '/api/permissions', '/api/hooks']) {
    const gate = authorize({ ...base, pathname: path, method: 'POST' });
    assert.equal(gate.allow, false, `${path} 不应允许写`);
  }
  // 未列入白名单的读路径也拒绝
  assert.equal(authorize({ ...base, pathname: '/api/tools', method: 'GET' }).allow, false);
  assert.equal(authorize({ ...base, pathname: '/usage', method: 'GET' }).allow, false);
  // 白名单内放行
  for (const path of ['/mobile', '/api/state', '/api/live', '/api/summary', '/api/analytics',
    '/src/animations/x.svg']) {
    assert.equal(authorize({ ...base, pathname: path, method: 'GET' }).allow, true, path);
  }
});

test('轮换保留宽限窗口，重置立即失效', () => {
  const before = currentToken();
  const rotated = rotateToken();
  assert.notEqual(rotated, before);
  assert.ok(tokenValid(rotated));
  assert.ok(tokenValid(before), '轮换后旧令牌应在宽限窗口内仍可用');

  const reset = resetToken();
  assert.ok(tokenValid(reset));
  assert.equal(tokenValid(rotated), false, '重置后旧令牌必须立即失效');
});

test('令牌有足够熵，不是可猜的短串', () => {
  const token = resetToken();
  assert.ok(token.length >= 20, `令牌太短: ${token.length}`);
  assert.notEqual(token, resetToken(), '每次重置必须不同');
});
