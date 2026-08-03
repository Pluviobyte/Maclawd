import { toCount } from './usage-record.js';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './store.js';
import { pricingCacheDir } from './paths.js';

/**
 * 成本估算。三层查价，越靠前优先级越高：
 *
 *   1. pricing.overrides.json   本地手工修正，永不被自动更新覆盖
 *   2. pricing.json             从 OpenRouter 拉取的价格表（用户显式触发更新）
 *   3. 内置家族关键词兜底        离线可用，只覆盖 Anthropic 家族
 *
 * **为什么要拉取而不是手工维护**：手工维护每出一个新模型就要改代码。实测本机
 * 21 个模型名里手工关键词表只覆盖 3 个家族，按 token 量算覆盖率仅 10%；换成
 * OpenRouter 的 367 个模型 + 名称归一化后，覆盖率到 97.8%，且新模型零改代码。
 *
 * 仍然坚持的一条：**未知模型不猜价格**，返回 null 由上层如实报告未计价量。
 * tokei 对未知模型按最贵的 Opus 兜底以求保守，但那会编出一个看起来精确、
 * 实际无依据的数字。
 *
 * 单价单位：美元 / 1M token。
 */

export const PRICING_FILE = 'pricing.json';

/** 价表缓存独立于用户数据目录，见 paths.js 的说明。 */
function pricingPath() {
  return join(pricingCacheDir(), PRICING_FILE);
}

function readPricing() {
  try {
    return JSON.parse(readFileSync(pricingPath(), 'utf-8'));
  } catch {
    return null;
  }
}

function writePricing(value) {
  const dir = pricingCacheDir();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, PRICING_FILE);
  const temp = join(dir, `.${PRICING_FILE}.${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(value), 'utf-8');
  renameSync(temp, target);
}
export const OVERRIDES_FILE = 'pricing.overrides.json';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';

// 内置离线兜底。倍率关系（缓存读 0.1×、5m 写 1.25×、1h 写 2× 输入价）比绝对数值稳定。
const CACHE_READ_RATIO = 0.1;
const WRITE_5M_RATIO = 1.25;
const WRITE_1H_RATIO = 2.0;
const FALLBACK_FAMILIES = [
  ['opus', [15, 75]],
  ['sonnet', [3, 15]],
  ['haiku', [0.8, 4]],
];

// Anthropic 官方 Claude Platform 价格（美元 / 1M token）。已知模型优先用
// 一方价格；OpenRouter 只补足其他供应商/模型。缓存倍率来自同一官方页面：
// https://platform.claude.com/docs/en/build-with-claude/prompt-caching
const OFFICIAL_PRICE_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const OFFICIAL_PRICES = new Map(Object.entries({
  'claude-fable-5': fromInputOutput(10, 50),
  'claude-opus-5': fromInputOutput(5, 25),
  'claude-opus-4-8': fromInputOutput(5, 25),
  'claude-opus-4-7': fromInputOutput(5, 25),
  'claude-opus-4-6': fromInputOutput(5, 25),
  'claude-opus-4-5': fromInputOutput(5, 25),
  'claude-sonnet-5': fromInputOutput(2, 10),
  'claude-haiku-4-5': fromInputOutput(0.8, 4),
}));

/** 永不计价：这些不是真实模型，而是工具内部的记账/别名条目。 */
const NON_MODELS = new Set(['<synthetic>', 'unknown', '', 'codex-auto-review']);

function fromInputOutput(input, output) {
  return {
    input,
    output,
    cacheRead: input * CACHE_READ_RATIO,
    write5m: input * WRITE_5M_RATIO,
    write1h: input * WRITE_1H_RATIO,
  };
}

// ---------- 名称归一化 ----------

/**
 * 本机模型名与 OpenRouter canonical id 的差异只有几类，逐个消除即可：
 *   provider 前缀      kimi-code/k3        → k3
 *   日期后缀           claude-haiku-4-5-20251001 → claude-haiku-4-5
 *   版本分隔符         claude-opus-4-6     → claude-opus-4.6
 *   产品档位后缀       grok-4.5-build      → grok-4.5
 *   上下文标记         kimi/k3[1m]         → k3
 *
 * 实测这套规则让 21 个真实模型名里 14 个自动命中，按 token 量覆盖 97.8%。
 */
export function nameVariants(model) {
  const base = String(model).trim().toLowerCase();
  if (!base) return [];
  const out = new Set();
  const add = (s) => { if (s) out.add(s); };

  const noPrefix = base.replace(/^[^/]*\//, '');
  for (const seed of [base, noPrefix]) {
    add(seed);
    const noDate = seed.replace(/-\d{8}$/, '');
    add(noDate);
    const noCtx = noDate.replace(/\[[^\]]*\]$/, '');
    add(noCtx);
    // 版本号里的 - 换成 .（claude-opus-4-6 → claude-opus-4.6）
    add(noCtx.replace(/(\d)-(\d)/g, '$1.$2'));
    // 产品档位后缀
    add(noCtx.replace(/-(build|code|coding|preview|latest|thinking)$/, ''));
  }
  return [...out];
}

// ---------- 价格表 ----------

let cache = null;

function loadTables() {
  if (cache) return cache;
  const overrides = readJson(OVERRIDES_FILE, {}) ?? {};
  const table = readPricing();
  const byId = new Map();
  const byBare = new Map();

  for (const [id, price] of Object.entries(table?.models ?? {})) {
    byId.set(id.toLowerCase(), price);
    const bare = id.includes('/') ? id.split('/').slice(1).join('/') : id;
    if (!byBare.has(bare.toLowerCase())) byBare.set(bare.toLowerCase(), price);
  }
  cache = { overrides, byId, byBare, meta: table?._meta ?? null };
  return cache;
}

export function resetPricingCache() {
  cache = null;
}

export function pricingMeta() {
  const { meta, byId } = loadTables();
  return {
    ...(meta ?? {}),
    models: byId.size,
    officialModels: OFFICIAL_PRICES.size,
    officialSource: OFFICIAL_PRICE_SOURCE,
  };
}

export function priceFor(model) {
  const raw = String(model ?? '').trim();
  if (NON_MODELS.has(raw) || NON_MODELS.has(raw.toLowerCase())) return null;

  const { overrides, byId, byBare } = loadTables();

  // 1. 手工修正优先，且允许只写 input/output 两个数
  let override = null;
  for (const variant of nameVariants(raw)) {
    override = overrides[variant] ?? overrides[variant.toLowerCase()];
    if (override) break;
  }
  if (override) {
    if (typeof override.input === 'number' && typeof override.output === 'number') {
      return { ...fromInputOutput(override.input, override.output), ...override };
    }
    return override;
  }

  // 2. 已知供应商的一方公开价格
  for (const variant of nameVariants(raw)) {
    const official = OFFICIAL_PRICES.get(variant);
    if (official) return official;
  }

  // 3. 拉取到的聚合价格表
  for (const variant of nameVariants(raw)) {
    const hit = byId.get(variant) ?? byBare.get(variant);
    if (hit) return hit;
  }

  // 4. 内置家族兜底
  const lower = raw.toLowerCase();
  for (const [keyword, [input, output]] of FALLBACK_FAMILIES) {
    if (lower.includes(keyword)) return fromInputOutput(input, output);
  }
  return null;
}

/** 返回该桶的成本，模型未知时返回 null（不猜）。 */
export function costOf(model, bucket) {
  const price = priceFor(model);
  if (!price) return null;
  return (
    toCount(bucket.input) / 1e6 * (price.input ?? 0)
    + toCount(bucket.output) / 1e6 * (price.output ?? 0)
    + toCount(bucket.cacheRead) / 1e6 * (price.cacheRead ?? 0)
    + toCount(bucket.write5m) / 1e6 * (price.write5m ?? 0)
    + toCount(bucket.write1h) / 1e6 * (price.write1h ?? price.write5m ?? 0)
  );
}

// ---------- 更新 ----------

/**
 * OpenRouter 的 pricing 字段是「每 token 美元」，且字段名与我们的口径一一对应：
 *   prompt → input          completion → output
 *   input_cache_read → cacheRead
 *   input_cache_write → write5m      input_cache_write_1h → write1h
 *
 * 缺 1h 档时按 2× 输入价推导（Anthropic 的公开倍率）。
 */
export function normalizeOpenRouter(entry) {
  const p = entry?.pricing;
  if (!p) return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n * 1e6 : null;
  };
  const input = num(p.prompt);
  const output = num(p.completion);
  if (input === null || output === null) return null;
  if (input === 0 && output === 0) return null; // 免费模型，不参与成本

  const cacheRead = num(p.input_cache_read);
  const write5m = num(p.input_cache_write);
  const write1h = num(p.input_cache_write_1h);
  return {
    input,
    output,
    cacheRead: cacheRead ?? input * CACHE_READ_RATIO,
    write5m: write5m ?? input * WRITE_5M_RATIO,
    write1h: write1h ?? input * WRITE_1H_RATIO,
  };
}

/**
 * 显式联网更新价格表。这是本项目**唯一**的对外网络请求（见
 * design/token-tracking.md 不可变原则 1），只发一个公开 GET，不携带任何用户数据。
 *
 * 只写 pricing.json，绝不动 pricing.overrides.json——手工修正必须在更新后依然生效。
 */
export async function updatePrices({ url = OPENROUTER_URL, timeoutMs = 30_000, now = null } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`价格表请求失败 HTTP ${response.status}`);
  const payload = await response.json();
  const list = Array.isArray(payload?.data) ? payload.data : [];
  if (list.length === 0) throw new Error('价格表为空，未覆盖本地文件');

  const models = {};
  let skipped = 0;
  for (const entry of list) {
    const price = normalizeOpenRouter(entry);
    if (!price || !entry.id) { skipped++; continue; }
    models[entry.id] = price;
  }
  if (Object.keys(models).length === 0) throw new Error('没有解析出任何价格，未覆盖本地文件');

  writePricing({
    _meta: {
      source: url,
      fetchedAt: now ?? new Date().toISOString(),
      count: Object.keys(models).length,
    },
    models,
  });
  resetPricingCache();
  return { count: Object.keys(models).length, skipped };
}
