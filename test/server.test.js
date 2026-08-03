import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 服务端契约测试。重点在两处安全边界：静态文件不得穿越出仓库、
 * /api/open 不得变成任意命令执行入口。
 */

const root = mkdtempSync(join(tmpdir(), 'maclawd-server-'));
process.env.MACLAWD_DATA_DIR = join(root, 'data');
// 不让测试碰到真实工具目录。
process.env.MACLAWD_CLAUDE_DIRS = join(root, 'empty-claude');
process.env.MACLAWD_CODEX_HOME = join(root, 'empty-codex');
process.env.MACLAWD_WORKBUDDY_DIR = join(root, 'empty-wb');
process.env.MACLAWD_KIMI_CODE_DIR = join(root, 'empty-kimi');
process.env.MACLAWD_KIMI_LEGACY_DIR = join(root, 'empty-kimi2');
process.env.MACLAWD_QWEN_DIR = join(root, 'empty-qwen');
process.env.MACLAWD_GROK_DIR = join(root, 'empty-grok');

const { createUsageServer } = await import('../src/runtime/server.js');
const { buildRollup } = await import('../src/runtime/rollup.js');
const { writeJson } = await import('../src/runtime/store.js');
const { ROLLUP_FILE } = await import('../src/runtime/paths.js');

let server;
let base;

before(async () => {
  // 造一份最小聚合数据，带一个已知项目路径。
  const records = [{
    source: 'claude-code', input: 100, output: 50, cacheRead: 900,
    write5m: 0, write1h: 0, reasoning: 0,
    model: 'claude-opus-5', project: 'Maclawd', ts: Date.now(),
  }];
  writeJson(ROLLUP_FILE, buildRollup(records, {}, { Maclawd: '/Users/rain/Desktop/Maclawd' }));

  // 测试里不启动后台采集循环，避免它去扫真实目录。
  ({ server } = createUsageServer({
    collector: {
      live: () => ({ tokensPerMin: 0, sources: [], trackedFiles: 0, disabled: false, updatedAt: null }),
      status: () => ({ running: false, scanning: false, enabled: true, live: {}, lastScan: null }),
      scanNow: async () => ({ records: 0, elapsedMs: 0, stats: {}, warnings: [] }),
      start: async () => {},
      stop: () => {},
    },
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
