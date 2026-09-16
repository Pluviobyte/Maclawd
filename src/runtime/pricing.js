import { normalizeServiceTier } from './billing-context.js';
export { normalizeServiceTier } from './billing-context.js';
import { toCount, throughput } from './usage-record.js';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './store.js';
import { pricingCacheDir } from './paths.js';
import { BUNDLED_OFFICIAL, OFFICIAL_URLS, parseOfficialPrices, rate } from './official-pricing.js';

export const PRICING_FILE = 'pricing.json';
export const OVERRIDES_FILE = 'pricing.overrides.json';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const FIELDS = ['input','output','cacheRead','write5m','write1h'];
const NON_MODELS = new Set(['<synthetic>','unknown','','codex-auto-review','auto']);
export const isPricingCandidate = model => !NON_MODELS.has(String(model ?? '').trim().toLowerCase());
const pricingPath = () => join(pricingCacheDir(),PRICING_FILE);
function readPricing() { try { return JSON.parse(readFileSync(pricingPath(),'utf8')); } catch { return null; } }
function writePricing(value) {
  mkdirSync(pricingCacheDir(),{recursive:true});
  const temp=join(pricingCacheDir(),`.${PRICING_FILE}.${process.pid}.tmp`);
  writeFileSync(temp,JSON.stringify(value));renameSync(temp,pricingPath());
}
// Only verified syntax aliases; arbitrary preview/code suffixes may represent different prices.
export function nameVariants(model) {
  const base=String(model??'').trim().toLowerCase().replace(/#billing=(api|subscription)$/,''); if(!base)return [];
  const variants=new Set();
  for(const seed of [base,base.replace(/^[^/]*\//,'')]) {
    const plain=seed.replace(/-\d{8}$/,'').replace(/\[[^\]]*\]$/,'');
    variants.add(seed);variants.add(plain);
    variants.add(plain.replace(/(\d)-(\d)/g,'$1.$2'));
    if(/^grok-.*-build$/.test(plain)) variants.add(plain.replace(/-build$/,''));
  }
  return [...variants];
}
let cache=null;
export function resetPricingCache(){cache=null;}
function loadTables() {
  if(cache)return cache;
  const table=readPricing();const byId=new Map(),byBare=new Map();
  for(const [id,price] of Object.entries(table?.models??{})) {
    byId.set(id.toLowerCase(),price);
    const bare=id.replace(/^[^/]*\//,'').toLowerCase();
    // Ambiguous bare names are not silently assigned to the first provider.
    if(byBare.has(bare))byBare.set(bare,null);else byBare.set(bare,price);
  }
  return cache={overrides:readJson(OVERRIDES_FILE,{})??{},byId,byBare,official:{...BUNDLED_OFFICIAL.models,...table?.officialModels},meta:table?._meta??null};
}
export function pricingMeta(){
  const {meta,byId,official}=loadTables();
  return {...meta,models:byId.size,officialModels:Object.keys(official).length,officialSource:OFFICIAL_URLS.anthropic,
    officialSources:OFFICIAL_URLS,requiresRefresh:meta?.schemaVersion!==2 || meta?.partial===true,estimateBasis:'current-api-prices'};
}
export function priceFor(model) {
  if(!isPricingCandidate(model))return null;
  const variants=nameVariants(model);const {overrides,official,byId,byBare}=loadTables();
  for(const v of variants) if(overrides[v])return {...overrides[v],provenance:'override',source:'pricing.overrides.json'};
  for(const v of variants) if(official[v])return official[v];
  for(const v of variants){const p=byId.get(v)??byBare.get(v);if(p)return p;}
  return null;
}
function priceRequest(price,bucket,{serviceTier='standard',promptTokens=null,unknownWriteTTL=false}={}) {
  if (unknownWriteTTL && toCount(bucket.write5m) > 0) return null;
  const tier=normalizeServiceTier(serviceTier);
  let p=tier==='standard'?price:price.tiers?.[tier];
  if(!p)return null;
  if(p.overrides?.length) {
    if(!Number.isFinite(promptTokens))return null;
    for(const rule of [...p.overrides].sort((a,b)=>a.above-b.above)) if(promptTokens>rule.above)p={...p,...rule};
  }
  let cost=0;
  for(const key of FIELDS){
    const count=toCount(bucket[key]);if(!count)continue;
    const unit=rate(p[key]);if(unit===null)return null;
    cost+=count/1e6*unit;
  }
  return cost;
}
/** Unknown rate components remain unpriced; never substitute free or generic cache multipliers. */
export function quoteBucket(model,bucket) {
  const price=priceFor(model);
  let cost=0,pricedTokens=0,unpricedTokens=0;
  const groups=bucket.chargeGroups?Object.entries(bucket.chargeGroups):[[JSON.stringify([bucket.serviceTier??'standard',Object.hasOwn(bucket,'promptTokens')?bucket.promptTokens:(toCount(bucket.input)+toCount(bucket.cacheRead)+toCount(bucket.write5m)+toCount(bucket.write1h))]),bucket]];
  for(const [key,group] of groups){
    const [serviceTier,promptTokens,unknownWriteTTL]=JSON.parse(key);
    const value=price?priceRequest(price,group,{serviceTier,promptTokens,unknownWriteTTL}):null;
    if(value===null)unpricedTokens+=throughput(group);else{cost+=value;pricedTokens+=throughput(group);}
  }
  return {cost:pricedTokens>0?cost:null,pricedTokens,unpricedTokens,provenance:price?.provenance??'unknown',source:price?.source??null,verifiedAt:price?.verifiedAt??null};
}
export function costOf(model,bucket) {
  const q=quoteBucket(model,bucket);return q.cost??(throughput(bucket)===0&&priceFor(model)?0:null);
}
costOf.quote = quoteBucket;

export function normalizeOpenRouter(entry) {
  const p=entry?.pricing;if(!p)return null;
  const convert=x=>{const n=rate(x);return n===null?null:n*1e6;};
  const read=row=>({input:convert(row.prompt),output:convert(row.completion),cacheRead:convert(row.input_cache_read),write5m:convert(row.input_cache_write),write1h:convert(row.input_cache_write_1h)});
  const result=read(p);if(result.input===null||result.output===null)return null;
  // Explicitly free models remain priced at zero, including cache components.
  if(result.input===0&&result.output===0)for(const k of FIELDS)result[k]??=0;
  const overrides=(p.overrides??[]).flatMap(row=>{
    const threshold=rate(row.min_prompt_tokens);
    if(threshold===null)return [];
    const rates=read(row);return [{above:threshold,...Object.fromEntries(Object.entries(rates).filter(([,v])=>v!==null))}];
  });
  return {...result,...(overrides.length?{overrides}:{}),provenance:'catalog',source:OPENROUTER_URL};
}
/** Only public catalogs are requested. Failed provider refreshes preserve its last good snapshot. */
export async function updatePrices({url=OPENROUTER_URL,timeoutMs=30_000,now=null,signal=null,officialUrls=url===OPENROUTER_URL?OFFICIAL_URLS:{}}={}) {
  const stamp=now??new Date().toISOString();
  const request=async target=>{
    const timeout=AbortSignal.timeout(timeoutMs);
    const response=await fetch(target,{headers:{Accept:target===url?'application/json':'text/markdown'},signal:signal?AbortSignal.any([signal,timeout]):timeout});
    if(!response.ok)throw new Error(`价格表请求失败 HTTP ${response.status}`);
    return response;
  };
  const previous = readPricing();
  let models = { ...previous?.models }, skipped = 0, catalogError = null;
  const officialModels = { ...previous?.officialModels };
  const officialStatus = { ...previous?._meta?.officialStatus };
  let catalogStatus;
  await Promise.all([
    (async () => {
      try {
        const payload = await (await request(url)).json();
        const list = Array.isArray(payload?.data) ? payload.data : [];
        if (!list.length) throw new Error('价格表为空，未覆盖本地文件');
        const next = {};
        for (const entry of list) {
          const p = normalizeOpenRouter(entry);
          if (!p || !entry.id) { skipped++; continue; }
          next[entry.id] = { ...p, verifiedAt: stamp };
        }
        if (!Object.keys(next).length) throw new Error('没有解析出任何价格，未覆盖本地文件');
        models = next;
        catalogStatus = { ok: true, verifiedAt: stamp };
      } catch (error) {
        catalogError = error;
        catalogStatus = { ok: false, error: error.message,
          lastSuccessAt: previous?._meta?.catalogStatus?.verifiedAt ?? previous?._meta?.fetchedAt ?? null };
      }
    })(),
    ...Object.entries(officialUrls).map(async ([provider, target]) => {
      try {
        const prices = parseOfficialPrices(provider, await (await request(target)).text(), stamp);
        Object.assign(officialModels, prices);
        officialStatus[provider] = { ok: true, verifiedAt: stamp };
      } catch (error) {
        officialStatus[provider] = { ok: false, error: error.message,
          lastSuccessAt: previous?._meta?.officialStatus?.[provider]?.verifiedAt
            ?? previous?._meta?.officialStatus?.[provider]?.lastSuccessAt ?? BUNDLED_OFFICIAL.verifiedAt };
      }
    }),
  ]);
  signal?.throwIfAborted();
  const anyOfficialSuccess = Object.keys(officialUrls).some(provider => officialStatus[provider]?.ok);
  if (catalogError && !anyOfficialSuccess) throw catalogError;
  const partial = !catalogStatus.ok || Object.values(officialStatus).some(status => !status.ok);
  writePricing({ _meta: { schemaVersion: 2, source: url, fetchedAt: stamp,
    count: Object.keys(models).length, officialStatus, catalogStatus, partial }, models, officialModels });
  resetPricingCache();
  return { count: Object.keys(models).length, skipped, officialStatus, catalogStatus, partial };
}
