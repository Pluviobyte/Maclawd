import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'maclawd-pricing-'));
process.env.MACLAWD_DATA_DIR = join(root, 'data');
// 价表缓存刻意与用户数据目录分开（见 paths.js），测试也要分开隔离
process.env.MACLAWD_PRICING_DIR = join(root, 'cache');

const {
  costOf, nameVariants, normalizeOpenRouter, priceFor,
  pricingMeta, resetPricingCache, updatePrices,
  PRICING_FILE, OVERRIDES_FILE,
} = await import('../src/runtime/pricing.js');
const { writeJson } = await import('../src/runtime/store.js');
const { pricingCacheDir } = await import('../src/runtime/paths.js');
const { mkdirSync, writeFileSync } = await import('node:fs');

/** 直接往价表缓存目录写，模拟一次成功的拉取。 */
function writePricingTable(value) {
  mkdirSync(pricingCacheDir(), { recursive: true });
  writeFileSync(join(pricingCacheDir(), PRICING_FILE), JSON.stringify(value), 'utf-8');
}

after(() => rmSync(root, { recursive: true, force: true }));

// ---------- 名称归一化 ----------

test('nameVariants 消除 provider 前缀、日期后缀、版本分隔符', () => {
  // 实测本机出现过的每一类差异
  assert.ok(nameVariants('claude-haiku-4-5-20251001').includes('claude-haiku-4.5'));
  assert.ok(nameVariants('claude-opus-4-6').includes('claude-opus-4.6'));
  assert.ok(nameVariants('kimi-code/k3').includes('k3'));
  assert.ok(nameVariants('kimi/k3[1m]').includes('k3'));
  assert.ok(nameVariants('grok-4.5-build').includes('grok-4.5'));
  assert.equal(nameVariants('').length, 0);
});

test('nameVariants 保留原名，避免归一化把能直接命中的名字弄丢', () => {
  assert.ok(nameVariants('gpt-5.6-sol').includes('gpt-5.6-sol'));
  assert.ok(nameVariants('claude-fable-5').includes('claude-fable-5'));
});

// ---------- OpenRouter 字段换算 ----------

test('normalizeOpenRouter 把每 token 单价换算成每 1M', () => {
  const price = normalizeOpenRouter({
    pricing: {
      prompt: '0.00001', completion: '0.00005',
      input_cache_read: '0.000001', input_cache_write: '0.0000125',
      input_cache_write_1h: '0.00002',
    },
  });
  assert.equal(price.input, 10);
  assert.equal(price.output, 50);
  assert.equal(price.cacheRead, 1);
  assert.equal(price.write5m, 12.5);
  assert.equal(price.write1h, 20);
});

test('normalizeOpenRouter 缺 1h 档时按 2× 输入价推导', () => {
  const price = normalizeOpenRouter({
    pricing: { prompt: '0.000001', completion: '0.000003' },
  });
  assert.equal(price.input, 1);
  assert.equal(price.write1h, 2, '1h TTL 是 2× 输入价');
  assert.equal(price.write5m, 1.25);
  assert.equal(price.cacheRead, 0.1);
});

test('normalizeOpenRouter 拒绝免费模型与缺价条目', () => {
  assert.equal(normalizeOpenRouter({ pricing: { prompt: '0', completion: '0' } }), null);
  assert.equal(normalizeOpenRouter({ pricing: {} }), null);
  assert.equal(normalizeOpenRouter({}), null);
});

// ---------- 三层查价 ----------

test('非真实模型永不计价', () => {
  resetPricingCache();
  for (const model of ['<synthetic>', 'unknown', '', 'codex-auto-review']) {
    assert.equal(priceFor(model), null, `${model} 不应有价格`);
  }
});

test('内置家族兜底在没有价格表时可用', () => {
  resetPricingCache();
  const opus = priceFor('claude-opus-4-8');
  assert.ok(opus && opus.input === 15);
  assert.equal(priceFor('某个完全没见过的模型'), null, '未知模型不猜价格');
});

test('拉取到的价格表能命中归一化后的名称', () => {
  writePricingTable({
    _meta: { fetchedAt: '2026-07-30T00:00:00.000Z', count: 2 },
    models: {
      'anthropic/claude-fable-5': { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
      'openai/gpt-5.6-sol': { input: 1, output: 8, cacheRead: 0.1, write5m: 1.25, write1h: 2 },
    },
  });
  resetPricingCache();
  // 手工关键词表里没有 fable，这条正是自动适配要解决的场景
  assert.equal(priceFor('claude-fable-5').input, 5);
  assert.equal(priceFor('gpt-5.6-sol').output, 8);
  assert.equal(pricingMeta().models, 2);
});

test('overrides 优先于价格表，且可以只写 input/output', () => {
  writeJson(OVERRIDES_FILE, { 'kimi-code/k3': { input: 2, output: 8 } });
  resetPricingCache();
  const k3 = priceFor('kimi-code/k3');
  assert.equal(k3.input, 2);
  assert.equal(k3.write1h, 4, '缺省档位按倍率补齐');

  writeJson(OVERRIDES_FILE, { 'claude-fable-5': { input: 99, output: 99, cacheRead: 9, write5m: 9, write1h: 9 } });
  resetPricingCache();
  assert.equal(priceFor('claude-fable-5').input, 99, 'overrides 必须压过价格表');
});

test('costOf 按五档单价分别计价', () => {
  writeJson(OVERRIDES_FILE, {});
  writePricingTable({
    _meta: {}, models: { 'x/m': { input: 10, output: 100, cacheRead: 1, write5m: 12.5, write1h: 20 } },
  });
  resetPricingCache();
  const cost = costOf('m', {
    input: 1e6, output: 1e6, cacheRead: 1e6, write5m: 1e6, write1h: 1e6,
  });
  assert.equal(cost, 10 + 100 + 1 + 12.5 + 20);
  assert.equal(costOf('<synthetic>', { input: 1e9 }), null);
});

// ---------- 更新流程（本地 fixture，不联网） ----------

test('updatePrices 写入价格表但绝不触碰 overrides', async () => {
  writeJson(OVERRIDES_FILE, { 'my-model': { input: 1, output: 2 } });
  const fixture = {
    data: [
      { id: 'anthropic/claude-opus-9', pricing: { prompt: '0.00002', completion: '0.0001' } },
      { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
      { id: 'broken/model' },
    ],
  };
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixture));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const result = await updatePrices({ url, now: '2026-07-30T12:00:00.000Z' });
  server.close();

  assert.equal(result.count, 1, '只有一条有效价格');
  assert.equal(result.skipped, 2, '免费与缺价条目被跳过');
  assert.equal(priceFor('claude-opus-9').input, 20);
  // overrides 必须原样保留
  assert.equal(priceFor('my-model').input, 1);
  assert.equal(pricingMeta().fetchedAt, '2026-07-30T12:00:00.000Z');
});

test('updatePrices 拿到空列表时不覆盖本地价格表', async () => {
  const before = priceFor('claude-opus-9').input;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  await assert.rejects(() => updatePrices({ url }), /价格表为空/);
  server.close();
  resetPricingCache();
  assert.equal(priceFor('claude-opus-9').input, before, '失败不得清空已有价格');
});

test('updatePrices 遇到 HTTP 错误时抛出且不覆盖', async () => {
  const server = createServer((req, res) => { res.writeHead(503); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(() => updatePrices({ url }), /HTTP 503/);
  server.close();
});


test('价表缓存与用户数据目录分离——清掉用户数据不该丢价表', () => {
  writePricingTable({ _meta: { count: 1 }, models: { 'x/keeper': { input: 7, output: 7 } } });
  resetPricingCache();
  assert.equal(priceFor('keeper').input, 7);
  // 模拟「换了数据目录 / 清了用户数据」
  process.env.MACLAWD_DATA_DIR = join(root, 'data-new');
  resetPricingCache();
  assert.equal(priceFor('keeper').input, 7, '价表不该跟着用户数据目录走');
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
});
