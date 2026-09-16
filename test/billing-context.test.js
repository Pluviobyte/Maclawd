import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {buildRollup,summarize} from '../src/runtime/rollup.js';
import {costOf,quoteBucket} from '../src/runtime/pricing.js';
import {parseObject} from '../src/runtime/parsers/claude-code.js';
const root=mkdtempSync(join(tmpdir(),'billing-context-'));process.env.MACLAWD_DATA_DIR=root;process.env.MACLAWD_PRICING_DIR=root;
process.on('exit',()=>rmSync(root,{recursive:true,force:true}));
const record=(input,output,serviceTier='standard')=>({source:'codex',model:'gpt-6-astra',project:'fixture',input,output,cacheRead:0,write5m:0,write1h:0,reasoning:0,ts:Date.parse('2026-09-16T00:00:00Z'),billing:{serviceTier,promptTokens:input}});
test('daily and slot aggregation retain each request threshold and tier through serialization',()=>{
 const records=[record(150000,10000),record(150000,10000),record(300000,10000),record(100000,10000,'fast'),record(100000,10000,'flex')];
 const rollup=JSON.parse(JSON.stringify(buildRollup(records)));
 assert.equal(summarize(rollup,'all',{priceBucket:costOf}).cost,14.5);
 const cell=Object.values(Object.values(rollup.slots)[0].sources.codex.cells)[0];
 assert.equal(costOf('gpt-6-astra',cell),14.5);
 assert.equal(Object.keys(cell.chargeGroups).length,4);
});
test('unknown request context or tier remains unpriced without hiding the known part',()=>{
 const rows=[record(100000,0),record(100000,0,'unpublished')];rows.push({...record(100000,0),billing:{promptTokens:null}});
 const rollup=buildRollup(rows);const summary=summarize(rollup,'all',{priceBucket:costOf});
 assert.equal(summary.cost,1);assert.equal(summary.unpricedTokens,200000);assert.deepEqual(summary.unpricedModels,['gpt-6-astra']);
 const cell=Object.values(Object.values(rollup.slots)[0].sources.codex.cells)[0];assert.equal(quoteBucket('gpt-6-astra',cell).pricedTokens,100000);
});
test('Claude speed and cache TTL produce exact Fast cost without double reasoning',()=>{
 const r=parseObject({type:'assistant',timestamp:'2026-09-16T00:00:00Z',message:{model:'claude-opus-5',usage:{input_tokens:100000,output_tokens:10000,cache_read_input_tokens:100000,cache_creation:{ephemeral_1h_input_tokens:10000},speed:'fast'}}});
 const rollup=buildRollup([r]);assert.equal(summarize(rollup,'all',{priceBucket:costOf}).cost,1.8);
 assert.equal(summarize(rollup,'all').throughput,220000);
});
