import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 服务端契约测试。重点在两处安全边界：静态文件不得穿越出仓库、
 * /api/open 不得变成任意命令执行入口。
 */

const root = mkdtempSync(join(tmpdir(), 'maclawd-server-'));
process.env.MACLAWD_DATA_DIR = join(root, 'data');
const CLAUDE_SETTINGS = join(root, 'claude-settings.json');
process.env.MACLAWD_CLAUDE_SETTINGS = CLAUDE_SETTINGS;
// 不让测试碰到真实工具目录。
process.env.MACLAWD_CLAUDE_DIRS = join(root, 'empty-claude');
process.env.MACLAWD_CODEX_HOME = join(root, 'empty-codex');
process.env.MACLAWD_WORKBUDDY_DIR = join(root, 'empty-wb');
process.env.MACLAWD_WORKBUDDY_SETTINGS = join(root, 'workbuddy-settings.json');
process.env.MACLAWD_KIMI_CODE_DIR = join(root, 'empty-kimi');
process.env.MACLAWD_KIMI_LEGACY_DIR = join(root, 'empty-kimi2');
process.env.MACLAWD_QWEN_DIR = join(root, 'empty-qwen');
process.env.MACLAWD_GROK_DIR = join(root, 'empty-grok');
process.env.MACLAWD_RUNTIME_BUILD_ID = 'test-build';

const { createUsageServer } = await import('../src/runtime/server.js');
const { buildRollup } = await import('../src/runtime/rollup.js');
const { writeJson } = await import('../src/runtime/store.js');
const { ROLLUP_FILE } = await import('../src/runtime/paths.js');
const { clearQuota, recordQuota } = await import('../src/runtime/account-quota.js');
const { createCodexQuotaCollector } = await import('../src/runtime/codex-quota.js');
const { createWorkBuddyQuotaCollector } = await import('../src/runtime/workbuddy-quota.js');

let server;
let base;
let quotaWorker;
let workBuddyQuotaWorker;
const collectorLive = {
  tokensPerMin: 0,
  tokensPerMinBySource: {},
  sources: [],
  trackedFiles: 0,
  disabled: false,
  updatedAt: null,
};

before(async () => {
  // 造一份最小聚合数据，带一个已知项目路径。
  const records = [{
    source: 'claude-code', input: 100, output: 50, cacheRead: 900,
    write5m: 0, write1h: 0, reasoning: 0,
    model: 'claude-opus-5', project: 'Maclawd', ts: Date.now(),
  }];
  writeJson(ROLLUP_FILE, buildRollup(records, {}, { Maclawd: '/Users/rain/Desktop/Maclawd' }));

  // 测试里不启动后台采集循环，避免它去扫真实目录。
  quotaWorker = createCodexQuotaCollector({
    enabled: () => true,
    command: '/fake/codex',
    intervalMs: 60_000,
    read: async () => ({
      rateLimits: {
        limitId: 'codex', planType: 'pro',
        primary: { usedPercent: 51, windowDurationMins: 10_080, resetsAt: Math.floor(Date.now() / 1000) + 86_400 },
      },
    }),
  });
  workBuddyQuotaWorker = createWorkBuddyQuotaCollector({
    enabled: () => true,
    intervalMs: 60_000,
    read: async () => ({
      source: 'workbuddy', sourceLabel: 'WorkBuddy', completeSnapshot: true,
      windows: {
        base_1: {
          label: '基础体验包', kind: 'base', used: 25, limit: 100,
          remaining: 75, usedPercent: 25, resetAt: Date.now() + 86_400_000,
        },
      },
    }),
  });
  ({ server } = createUsageServer({
    collector: {
      live: () => ({ ...collectorLive }),
      status: () => ({ running: false, scanning: false, enabled: true, live: {}, lastScan: null }),
      scanNow: async () => ({ records: 0, elapsedMs: 0, stats: {}, warnings: [] }),
      start: async () => {},
      stop: () => {},
    },
    quotaCollector: quotaWorker,
    workBuddyQuotaCollector: workBuddyQuotaWorker,
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (path) => fetch(base + path);
const json = async (path) => (await get(path)).json();

test('页面与静态资源可访问', async () => {
  for (const path of ['/', '/usage']) {
    const res = await get(path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /Maclawd/);
  }
  assert.equal((await get('/src/animations/calm-calibration.svg')).status, 200);
});

test('/api/ping 暴露可校验的运行时身份与协议版本', async () => {
  const ping = await json('/api/ping');
  assert.equal(ping.maclawd, true);
  assert.equal(ping.protocolVersion, 1);
  assert.equal(ping.buildId, 'test-build');
  assert.equal(ping.pid, process.pid);
  assert.ok(Number.isInteger(ping.port) && ping.port > 0);
  assert.match(ping.instanceId, /^[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(ping.startedAt) && ping.startedAt <= Date.now());
});

test('Codex GUI 真实事件不被 5 分钟 Token 速率覆盖', async () => {
  collectorLive.tokensPerMin = 2_000;
  collectorLive.tokensPerMinBySource = { codex: 2_000 };
  collectorLive.sources = ['codex'];
  try {
    const response = await fetch(`${base}/api/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'UserPromptSubmit', sessionId: 'gui-latency',
        agentId: 'codex', channel: 'jsonl',
      }),
    });
    const snapshot = await response.json();
    assert.equal(snapshot.state.actionId, 'thinking');
    assert.equal(snapshot.state.sessionId, 'codex:gui-latency');
  } finally {
    collectorLive.tokensPerMin = 0;
    collectorLive.tokensPerMinBySource = {};
    collectorLive.sources = [];
  }
});

test('静态路径不得穿越出仓库', async () => {
  for (const path of [
    '/../package.json',
    '/..%2fpackage.json',
    '/../../etc/passwd',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  ]) {
    const res = await get(path);
    assert.ok(res.status === 404 || res.status === 400, `${path} 返回了 ${res.status}`);
  }
});

test('/api/summary 返回两种口径与覆盖率', async () => {
  const d = await json('/api/summary?range=all');
  assert.equal(d.summary.billable, 150);
  assert.equal(d.summary.throughput, 1050);
  assert.equal(d.summary.throughput - d.summary.billable, 900, '差额就是缓存读');
  assert.ok(d.coverage >= 0 && d.coverage <= 1);
  assert.deepEqual(d.dimensions.models, ['claude-opus-5']);
  assert.deepEqual(d.dimensions.projects, ['Maclawd']);
});

test('/api/summary 的筛选参数生效且未知区间回落 today', async () => {
  const hit = await json('/api/summary?range=all&model=claude-opus-5');
  assert.equal(hit.summary.billable, 150);
  const miss = await json('/api/summary?range=all&model=不存在的模型');
  assert.equal(miss.summary.billable, 0);
  const fallback = await json('/api/summary?range=乱写');
  assert.equal(fallback.range, 'today');
});

test('/api/analytics 暴露统一的同比、趋势、热力图、分布和分页明细', async () => {
  const d = await json('/api/analytics?range=7d&model=claude-opus-5&limit=1');
  assert.equal(d.range, '7d');
  assert.equal(d.totals.totalTokens, 1050);
  assert.equal(d.totals.inputTokens, 100);
  assert.equal(d.heatmap.length, 168);
  assert.equal(d.series.length, 7);
  assert.deepEqual(d.distributions.models.map((x) => x.id), ['claude-opus-5']);
  assert.equal(d.records.items.length, 1);
  assert.equal(d.records.nextCursor, null);
  assert.equal(d.sessions.available, false, '模型筛选下会话指标不能伪造');
  assert.ok(d.cost.coverage >= 0 && d.cost.coverage <= 1);
  assert.equal(d.collection.complete, true);
  assert.equal(d.totals.nonCachedReadTokens, d.totals.billableTokens);
});

test('聚合结构版本不匹配时明确报 stale，而不是静默返回 0', async () => {
  writeJson(ROLLUP_FILE, { v: 0, days: {}, sessions: {} });
  const d = await json('/api/summary?range=all');
  assert.equal(d.empty, true);
  assert.equal(d.stale, true);

  // 恢复，供后续测试使用
  const records = [{
    source: 'claude-code', input: 100, output: 50, cacheRead: 900,
    write5m: 0, write1h: 0, reasoning: 0,
    model: 'claude-opus-5', project: 'Maclawd', ts: Date.now(),
  }];
  writeJson(ROLLUP_FILE, buildRollup(records, {}, { Maclawd: '/Users/rain/Desktop/Maclawd' }));
});

test('/api/actions 返回全部动作与角色合同', async () => {
  const d = await json('/api/actions');
  assert.ok(d.actions.length >= 38, `只拿到 ${d.actions.length} 个动作`);
  // 别名条目（如 ambient.power_connected → waking）只有 id + mapsTo，没有 name。
  // 早先按「必须有 name」过滤，把别名整条滤掉了，导致 mapsTo 永远读不到。
  assert.ok(d.actions.every((a) => a.id && (a.name || a.mapsTo)));
  const alias = d.actions.find((a) => a.mapsTo);
  assert.ok(alias, '别名条目必须出现在动作清单里');
  assert.equal(d.contract.bodyColor, '#DE886D');
});

test('/api/quota 刷新 Codex 与 WorkBuddy 后和 Claude Code 按服务商分开返回', async () => {
  clearQuota();
  recordQuota({
    source: 'claude-code',
    windows: {
      five_hour: { usedPercent: 20, resetAt: Date.now() + 3_600_000 },
    },
  });

  await json('/api/quota');
  const deadline = Date.now() + 200;
  let snapshot;
  do {
    snapshot = await json('/api/quota');
    if (snapshot.sources.some((source) => source.id === 'codex')
      && snapshot.sources.some((source) => source.id === 'workbuddy')) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  } while (Date.now() < deadline);

  assert.deepEqual(snapshot.sources.map((source) => source.label), ['Claude Code', 'Codex', 'WorkBuddy']);
  assert.equal(snapshot.sources.find((source) => source.id === 'codex').windows[0].usedPercent, 51);
  assert.equal(snapshot.sources.find((source) => source.id === 'workbuddy').windows[0].remaining, 75);
  assert.equal(snapshot.workBuddy.lastError, null);
});

test('/api/settings 只接受已知键，未知键被丢弃', async () => {
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    body: JSON.stringify({ showCost: true, 恶意键: '删库' }),
  });
  const { settings } = await res.json();
  assert.equal(settings.showCost, true);
  assert.equal('恶意键' in settings, false);
  // 默认值仍然在
  assert.equal(settings.recordUsage, true);
  assert.equal(settings.hookEnhancement, false, 'hook 增强必须默认关闭');
  assert.equal(settings.workBuddyHookEnhancement, false, 'WorkBuddy hook 增强必须默认关闭');
});

test('WorkBuddy 设置开关会真正安装和卸载状态 Hooks', async () => {
  const enabled = await post('/api/settings', { workBuddyHookEnhancement: true });
  assert.equal(enabled.settings.workBuddyHookEnhancement, true);
  assert.match(enabled.effects.join(' '), /WorkBuddy 状态事件/);
  const active = JSON.parse(readFileSync(process.env.MACLAWD_WORKBUDDY_SETTINGS, 'utf8'));
  assert.ok(active.hooks.PreToolUse.some((group) =>
    group.hooks?.some((hook) => hook.command?.endsWith('PreToolUse --maclawd-source=workbuddy'))));
  assert.equal(Object.hasOwn(active.hooks, 'PermissionRequest'), false);

  const disabled = await post('/api/settings', { workBuddyHookEnhancement: false });
  assert.equal(disabled.settings.workBuddyHookEnhancement, false);
  const cleaned = JSON.parse(readFileSync(process.env.MACLAWD_WORKBUDDY_SETTINGS, 'utf8'));
  assert.equal(Object.hasOwn(cleaned, 'hooks'), false);
});

test('开启额度读取时自动兼容 Claude HUD，关闭后完整恢复', async () => {
  const claudeHud = {
    type: 'command',
    command: 'bash -c \'exec "$HOME/.claude/plugins/cache/claude-hud/claude-hud/0.0.1/src/index.ts"\'',
    padding: 0,
  };
  writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify({ statusLine: claudeHud }, null, 2)}\n`);

  const enabled = await post('/api/settings', { quotaStatusline: true });
  assert.equal(enabled.settings.quotaStatusline, true);
  assert.match(enabled.effects.join(' '), /Claude HUD|串联|兼容/);

  const active = await json('/api/statusline');
  assert.equal(active.state, 'chained');
  assert.equal(active.foreignCommand, claudeHud.command);

  const disabled = await post('/api/settings', { quotaStatusline: false });
  assert.equal(disabled.settings.quotaStatusline, false);
  assert.deepEqual(JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8')).statusLine, claudeHud);
});

test('设置开关不能借隐藏参数自动修改未知状态行', async () => {
  const custom = { type: 'command', command: '/usr/local/bin/my-statusline' };
  writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify({ statusLine: custom }, null, 2)}\n`);

  const result = await post('/api/settings', {
    quotaStatusline: true,
    chainExisting: true,
  });

  assert.equal(result.settings.quotaStatusline, false);
  assert.equal(result.blocked, 'statusline');
  assert.deepEqual(JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8')).statusLine, custom);
});

test('自定义 Claude 状态行被保护时，Codex 额度读取仍可独立开启', async () => {
  const custom = { type: 'command', command: '/usr/local/bin/my-statusline' };
  writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify({ statusLine: custom }, null, 2)}\n`);

  const result = await post('/api/settings', { quotaTracking: true });
  assert.equal(result.settings.quotaTracking, true);
  assert.equal(result.settings.quotaStatusline, false);
  assert.equal(result.blocked, 'statusline');
  assert.deepEqual(JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8')).statusLine, custom);

  await post('/api/settings', { quotaTracking: false });
});

test('关闭统一额度开关后不再接收 Claude Code 上报', async () => {
  await post('/api/settings', { quotaTracking: false });
  const response = await post('/api/quota', {
    source: 'claude-code',
    windows: { five_hour: { usedPercent: 77, resetAt: Date.now() + 3_600_000 } },
  });
  assert.deepEqual(response, { ignored: true });
});

test('/api/open 拒绝未知动作与未知路径', async () => {
  const post = (body) => fetch(`${base}/api/open`, { method: 'POST', body: JSON.stringify(body) });

  const badAction = await post({ action: 'rm', path: '/Users/rain/Desktop/Maclawd' });
  assert.equal(badAction.status, 500);
  assert.match((await badAction.json()).error, /不支持/);

  // 路径必须恰好等于 rollup 里记录过的项目路径
  const badPath = await post({ action: 'finder', path: '/etc' });
  assert.equal(badPath.status, 500);
  assert.match((await badPath.json()).error, /未知项目路径/);

  const traversal = await post({ action: 'finder', path: '/Users/rain/Desktop/Maclawd/../../../etc' });
  assert.equal(traversal.status, 500);
});

test('/api/reset 删除派生数据后 summary 变空', async () => {
  const res = await fetch(`${base}/api/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
  const d = await json('/api/summary?range=all');
  assert.equal(d.empty, true);
});

test('未知 API 路径返回 404', async () => {
  assert.equal((await get('/api/不存在')).status, 404);
});

// ---------- mini（贴边）尺寸档 ----------

const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((r) => r.json());

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('收起与展开都必须经过转场，不允许瞬切', async () => {
  const before = await json('/api/state');
  assert.equal(before.mini, false);
  assert.ok(!before.plan.actionId.startsWith('mini.'), '一开始不该在 mini 档');

  // 外壳只提议；运行时决定并立刻进入收起转场
  const entering = await post('/api/event', { type: 'shell.miniEnter' });
  assert.equal(entering.mini, true);
  assert.equal(entering.plan.actionId, 'mini.enter', '没有播收起转场就切了尺寸档');
  assert.equal(entering.plan.mode, 'oneshot');

  // 转场期间重复提议不该打断它
  const during = await post('/api/event', { type: 'shell.miniEnter' });
  assert.equal(during.plan.actionId, 'mini.enter');

  await wait(entering.plan.durationMs + 120);
  const settled = await json('/api/state');
  assert.equal(settled.mini, true);
  assert.ok(settled.plan.actionId.startsWith('mini.'), `转场结束后应停在 mini 档：${settled.plan.actionId}`);
  assert.notEqual(settled.plan.actionId, 'mini.enter', '转场没有结束');

  // 展开同理：先播完 mini.exit 才真正回到主形态
  const leaving = await post('/api/event', { type: 'shell.miniExit' });
  assert.equal(leaving.plan.actionId, 'mini.exit');
  assert.equal(leaving.mini, true, '展开转场还没播完就报离开了 mini');

  await wait(leaving.plan.durationMs + 120);
  const back = await json('/api/state');
  assert.equal(back.mini, false);
  assert.ok(!back.plan.actionId.startsWith('mini.'), `应已回到主形态：${back.plan.actionId}`);
});

test('mini 档下主状态被收敛，且能看出是从哪收敛来的', async () => {
  const entering = await post('/api/event', { type: 'shell.miniEnter' });
  await wait(entering.plan.durationMs + 120);

  // 引擎照常产出主形态状态；只有编排器把它投影到 mini 档
  const s = await json('/api/state');
  assert.ok(!s.state.actionId.startsWith('mini.'), 'mini 不该污染状态引擎的输出');
  assert.ok(s.plan.actionId.startsWith('mini.'));
  assert.equal(s.plan.unmapped, false, '落到了未映射兜底，说明收敛表有缺口');

  const leaving = await post('/api/event', { type: 'shell.miniExit' });
  await wait(leaving.plan.durationMs + 120);
});
