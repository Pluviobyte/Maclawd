// Public first-party price facts, checked 2026-09-16; refreshed with the public catalogs.
// Vibe Usage fcf1c398 / ccusage 5e88263 inform the contract, not the rates.
import { readFileSync } from 'node:fs';
export const OFFICIAL_URLS = {
  openai: 'https://developers.openai.com/api/docs/pricing.md',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
};
export const BUNDLED_OFFICIAL = JSON.parse(readFileSync(new URL('./official-prices.json', import.meta.url), 'utf8'));
export function rate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (String(value).trim() === '') return null;
  const n = Number(String(value).replace(/^\$/, '').replace(/\s*\/\s*MTok.*$/, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function parseOfficialPrices(provider, text, verifiedAt) {
  const models = {};
  if (provider === 'openai') {
    let tier = null;
    for (const line of text.split('\n')) {
      if (/^#{1,6} /.test(line)) tier = /^### (Standard|Batch|Flex|Fast) pricing data\s*$/.exec(line)?.[1]?.toLowerCase() ?? null;
      if (!tier || !line.startsWith('| ')) continue;
      const c = line.split('|').slice(1,-1).map(s=>s.trim());
      if (c.length !== 9 || !/^(gpt-|o[134](?:-|$))/.test(c[0])) continue;
      const id = c[0].split(' ')[0];
      const values = c.slice(1).map(rate);
      if (values[0] == null || values[3] == null) continue;
      const price = {input:values[0],cacheRead:values[1],write5m:values[2],write1h:null,output:values[3]};
      if (values[4] != null && values[7] != null) {
        // Official model pages define >272K for these families; do not infer future thresholds.
        if (!/^gpt-(?:6-astra|5\.6-(?:sol|terra|luna)|5\.[45](?:-pro)?)$/.test(id)) continue;
        price.overrides = [{above:272000,input:values[4],cacheRead:values[5],write5m:values[6],write1h:null,output:values[7]}];
      }
      const entry = models[id] ??= {tiers:{},source:OFFICIAL_URLS.openai,verifiedAt,provenance:'official'};
      if (tier === 'standard') Object.assign(entry,price);
      else entry.tiers[tier] = price;
    }
  } else if (provider === 'anthropic') {
    for (const line of text.split('\n')) {
      if (!line.startsWith('| Claude ')) continue;
      const c=line.split('|').slice(1,-1).map(s=>s.trim());
      if(c.length!==6) continue;
      const name=/^Claude (Fable|Mythos|Opus|Sonnet|Haiku) (\d+(?:\.\d+)?)/.exec(c[0]);
      if(!name) continue;
      const values=c.slice(1).map(s=>rate(s.replace(/\s*\^.*$/,'')));
      if(values.some(v=>v==null)) continue;
      const id=`claude-${name[1].toLowerCase()}-${name[2]}`;
      models[id]={input:values[0],write5m:values[1],write1h:values[2],cacheRead:values[3],output:values[4],source:OFFICIAL_URLS.anthropic,verifiedAt,provenance:'official'};
    }
    let mode=null;
    for(const line of text.split('\n')) {
      if(line.startsWith('### ')) mode=line.includes('Fast mode pricing')?'fast':line.includes('Batch processing')?'batch':null;
      if(!mode || !line.startsWith('| Claude '))continue;
      const c=line.split('|').slice(1,-1).map(s=>s.trim());
      if(c.length!==3)continue;
      const input=rate(c[1]),output=rate(c[2]);if(input==null||output==null)continue;
      for(const match of c[0].matchAll(/Claude (Fable|Mythos|Opus|Sonnet|Haiku) (\d+(?:\.\d+)?)/g)) {
        const id=`claude-${match[1].toLowerCase()}-${match[2]}`;const p=models[id];if(!p||p.input<=0)continue;
        const multiplier=input/p.input;
        (p.tiers??={})[mode]={input,output,cacheRead:p.cacheRead*multiplier,write5m:p.write5m*multiplier,write1h:p.write1h*multiplier};
      }
    }
  }
  const valid=Object.fromEntries(Object.entries(models).filter(([,p])=>p.input!=null && p.output!=null));
  if(Object.keys(valid).length<2) throw new Error(`${provider} 官方价格表结构未识别`);
  return valid;
}
