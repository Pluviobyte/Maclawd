import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');

/**
 * 演示站是唯一一份会发到公网的产物，所以它有两条必须自动守住的性质：
 *
 * 1. **行为要真。** 状态部分跑的是真的 state-engine + orchestrator。
 *    如果哪天引擎的导出形态变了，打包会静默产出一个坏包，
 *    演示站就会展示一个不存在的产品——这里让它直接测挂。
 *
 * 2. **数据要假。** 一旦有人把真实 rollup、本机路径或家目录写进演示数据，
 *    那就是把「在做什么项目、烧了多少钱」发到公网。这条必须机器来守。
 */

let ctx = null;

/** 在一个假的 window/document 里把演示站的三个经典脚本按顺序跑起来。 */
function boot() {
  if (ctx) return ctx;
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-site.mjs')], { cwd: ROOT });

  const listeners = [];
  const sandbox = {
    console,
    Math,
    Date,
    URL,
    Response,
    Request,
    Promise,
    JSON,
    Set,
    Map,
    Number,
    Object,
    Array,
    String,
    Boolean,
    location: { origin: 'https://example.invalid' },
    document: {
      addEventListener: (type, fn) => listeners.push([type, fn]),
      createElement: () => ({ style: {}, setAttribute() {}, set innerHTML(_) {} }),
      body: { prepend() {} },
    },
  };
  sandbox.window = sandbox;
  sandbox.fetch = () => Promise.reject(new Error('演示站不该发真实请求'));
  createContext(sandbox);

  for (const file of ['demo-engine.js', 'demo-data.js', 'demo-actions.js', 'demo-mode.js']) {
    runInContext(readFileSync(join(SITE, file), 'utf8'), sandbox, { filename: file });
  }
  ctx = sandbox;
  return ctx;
}

const get = async (path) => {
  const w = boot();
  return (await w.fetch(path)).json();
};

test('演示站的动作清单来自真实契约', async () => {
  const w = boot();
  const { actions } = await get('/api/actions');
  assert.ok(actions.length >= 38, `动作数量异常：${actions.length}`);
  assert.ok(w.MaclawdEngine, '引擎没打进包里');
});

test('状态由真引擎计算，且能选出带素材的动作', async () => {
  const first = await get('/api/state');
  assert.equal(first.demo, true);
  assert.ok(first.plan, '没有选出任何动作');
  assert.ok(first.plan.source.endsWith('.svg'), `动作素材异常：${first.plan.source}`);
  // 开场铺了两个会话在竞争，仲裁表不能是空的——那正是这个面板要解释的东西
  assert.ok(first.debug.sessions.length >= 2, '仲裁表为空，演示看不到「为什么是它赢」');
  assert.ok(first.debug.sessions.some((s) => s.winner), '没有标出胜出会话');
});

test('事件按钮走的是真仲裁，不是写死的映射', async () => {
  const w = boot();
  const before = await get('/api/state');
  await w.fetch('/api/event', { method: 'POST', body: JSON.stringify({ type: 'PreCompact', sessionId: 'demo-a' }) });
  const after = await (await w.fetch('/api/state')).json();
  assert.notEqual(after.state.actionId, before.state.actionId, 'PreCompact 没有改变状态');
  assert.equal(after.state.actionId, 'compacting');
});

test('筛选是真的在按 来源 × 模型 × 项目 重算', async () => {
  const all = await get('/api/summary?range=month');
  const oneSource = await get('/api/summary?range=month&source=codex');
  assert.ok(oneSource.summary.throughput > 0, '筛选后没有数据');
  assert.ok(oneSource.summary.throughput < all.summary.throughput, '筛选没有生效');
  assert.deepEqual(Object.keys(oneSource.summary.bySource), ['codex']);

  // 跨维度组合：来源 + 项目同时收窄，必须比单条件更小
  const narrower = await get('/api/summary?range=month&source=codex&project=demo-storefront');
  assert.ok(narrower.summary.throughput < oneSource.summary.throughput, '组合筛选没有进一步收窄');
});

test('演示数据遵守两条口径不变量', async () => {
  const { summary } = await get('/api/summary?range=all');
  // billable 不含 cacheRead；throughput 含
  assert.equal(summary.billable, summary.input + summary.write5m + summary.write1h + summary.output);
  assert.equal(summary.throughput, summary.billable + summary.cacheRead);
  // reasoning 是 output 的信息性子计数，不该超过 output
  assert.ok(summary.reasoning < summary.output, 'reasoning 不该超过 output');
  // 覆盖率要真的小于 1，否则演示不出「有模型没价格」这件事
  assert.ok(summary.coverage > 0.5 && summary.coverage < 1, `覆盖率异常：${summary.coverage}`);
});

test('范围越大数据越多', async () => {
  const today = await get('/api/summary?range=today');
  const month = await get('/api/summary?range=month');
  assert.ok(month.summary.throughput > today.summary.throughput);
});

test('会改本机文件的接口在演示站上不假装成功', async () => {
  const w = boot();
  for (const path of ['/api/reset', '/api/scan', '/api/update-prices']) {
    const r = await (await w.fetch(path, { method: 'POST' })).json();
    assert.equal(r.ok, false, `${path} 假装成功了`);
  }
});

test('产物里不含任何真实的本机信息', () => {
  boot();
  const home = homedir();
  const user = home.split('/').pop();
  const files = ['demo-data.js', 'demo-actions.js', 'pet.html', 'usage.html', 'index.html'];
  for (const file of files) {
    const text = readFileSync(join(SITE, file), 'utf8');
    assert.ok(!text.includes(home), `${file} 含家目录路径`);
    if (user && user.length > 2) {
      assert.ok(!text.includes(`/${user}/`), `${file} 含用户名路径`);
    }
    assert.ok(!/\/Users\/[a-z]/i.test(text), `${file} 含 /Users/ 绝对路径`);
  }
  // 真实用量只可能从 rollup 泄露，演示产物里不该出现它
  assert.ok(!existsSync(join(SITE, 'rollup.json')), '演示站里出现了 rollup.json');
});
