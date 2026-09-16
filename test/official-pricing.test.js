import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseOfficialPrices} from '../src/runtime/official-pricing.js';
import {priceFor,costOf,normalizeOpenRouter,resetPricingCache} from '../src/runtime/pricing.js';
const root=mkdtempSync(join(tmpdir(),'official-pricing-'));
process.env.MACLAWD_PRICING_DIR=root;process.env.MACLAWD_DATA_DIR=root;
process.on('exit',()=>rmSync(root,{recursive:true,force:true}));
test('official published standard prices, free versus missing, unknown family stays unknown',()=>{
 resetPricingCache();assert.equal(priceFor('claude-haiku-4-5').input,1);assert.equal(priceFor('gpt-5.6-sol').input,4);
 assert.equal(priceFor('made-up-opus-99'),null);
 assert.equal(normalizeOpenRouter({pricing:{prompt:null,completion:'1'}}),null);
 assert.equal(normalizeOpenRouter({pricing:{prompt:'0',completion:'0'}}).output,0);
 assert.equal(costOf('gpt-6-astra',{input:300000,output:10000}),6.75);
 assert.equal(costOf('gpt-6-astra',{input:272000,output:10000}),3.22);
 assert.equal(costOf('gpt-6-astra',{input:100000,output:10000,serviceTier:'priority'}),3);
 assert.equal(costOf('gpt-6-astra',{input:100000,output:10000,serviceTier:'flex'}),.75);
 assert.equal(costOf('gpt-6-astra',{input:100000,serviceTier:'unknown-tier'}),null);
});
test('OpenAI official sections preserve explicit Fast/Batch/Flex and context thresholds',()=>{
 const text='### Standard pricing data\n| gpt-6-astra | $10 | $1 | $12.5 | $50 | $20 | $2 | $25 | $75 |\n| gpt-5.6-sol | $4 | $0.4 | $5 | $20 | $8 | $0.8 | $10 | $30 |\n### Fast pricing data\n| gpt-6-astra | $20 | $2 | $25 | $100 | $40 | $4 | $50 | $150 |';
 const p=parseOfficialPrices('openai',text,'2026-09-16');
 assert.equal(p['gpt-6-astra'].tiers.fast.input,20);assert.equal(p['gpt-6-astra'].overrides[0].above,272000);
 assert.throws(()=>parseOfficialPrices('openai','login/error page','now'),/结构/);
});
test('Anthropic explicit cache exception and Fast do not use global family ratios',()=>{
 const text='| Claude Fable 5.1 | $10 / MTok | $12.50 / MTok | $20 / MTok | $0.25 / MTok1 | $50 / MTok |\n| Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.5 / MTok | $25 / MTok |\n### Fast mode pricing\n| Claude Opus 5 / Claude Opus 4.8 | $10 / MTok | $50 / MTok |';
 const p=parseOfficialPrices('anthropic',text,'2026-09-16');
 assert.equal(p['claude-fable-5.1'].cacheRead,.25);assert.equal(p['claude-opus-5'].tiers.fast.write1h,20);
});
test('catalog refresh updates first-party tables, then retains them on provider failure',async()=>{
 const {createServer}=await import('node:http');const {updatePrices,pricingMeta}=await import('../src/runtime/pricing.js');
 let fail=false;
 const server=createServer((req,res)=>{
  if(req.url==='/official') {res.writeHead(fail?503:200);res.end('### Standard pricing data\n| gpt-6-astra | $11 | $1 | $12.5 | $50 | $20 | $2 | $25 | $75 |\n| gpt-5.6-sol | $4 | $0.4 | $5 | $20 | $8 | $0.8 | $10 | $30 |');}
  else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'vendor/model',pricing:{prompt:'0.000001',completion:'0.000002'}}]}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try {
  await updatePrices({url,officialUrls:{openai:url+'/official'},now:'2026-09-16T01:00:00Z'});
  assert.equal(priceFor('gpt-6-astra').input,11);
  fail=true;await updatePrices({url,officialUrls:{openai:url+'/official'}});
  assert.equal(priceFor('gpt-6-astra').input,11);assert.equal(pricingMeta().officialStatus.openai.ok,false);
 }finally{server.close();}
});

test('official refresh proceeds when the catalog fails, retaining the last catalog and retrying partial updates',async()=>{
 const {createServer}=await import('node:http');const {updatePrices,pricingMeta}=await import('../src/runtime/pricing.js');
 let catalogFail=false;
 const server=createServer((req,res)=>{
  if(req.url==='/official')res.end('### Standard pricing data\n| gpt-6-astra | $12 | $1 | $12.5 | $50 | $20 | $2 | $25 | $75 |\n| gpt-5.6-sol | $4 | $0.4 | $5 | $20 | $8 | $0.8 | $10 | $30 |');
  else if(catalogFail){res.writeHead(503);res.end('unavailable');}
  else res.end(JSON.stringify({data:[{id:'vendor/retained',pricing:{prompt:'0.000003',completion:'0.000006'}}]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
  await updatePrices({url,officialUrls:{}});catalogFail=true;
  const result=await updatePrices({url,officialUrls:{openai:url+'/official'}});
  assert.equal(result.partial,true);assert.equal(result.catalogStatus.ok,false);assert.equal(result.officialStatus.openai.ok,true);
  assert.equal(priceFor('vendor/retained').input,3);assert.equal(priceFor('gpt-6-astra').input,12);
  assert.equal(pricingMeta().requiresRefresh,true);
  assert.equal(costOf('gpt-6-astra',{input:300000,output:100,promptTokens:null}),null);
 }finally{server.close();}
});
