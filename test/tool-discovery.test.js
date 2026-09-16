import test from 'node:test';import assert from 'node:assert/strict';
import {discoverQuotaSources,discoverUsageSources,QUOTA_SOURCE_IDS} from '../src/runtime/tool-discovery.js';
const agent=(id,usage,quota=true)=>({id,installed:true,capabilities:{usage,quota}});
test('installed quota providers appear before first successful response; unsupported usage tools never get a fake quota',()=>{
 const r=discoverQuotaSources({sources:[]},{agents:[agent('cursor',true),agent('kimi-code',true),agent('mcode',true,false),agent('doubao',false,false)],statuses:{cursor:{lastError:{code:'EAUTH'}}}});
 assert.deepEqual(r.sources.map(s=>s.id),['cursor','kimi-code']);assert.equal(r.empty,false);assert.equal(r.sources[0].availability,'needs-login');assert.deepEqual(r.sources[0].windows,[]);
 assert.ok(QUOTA_SOURCE_IDS.has('grok'));assert.ok(QUOTA_SOURCE_IDS.has('cursor'));assert.ok(QUOTA_SOURCE_IDS.has('kimi-code'));
});
test('discovery rechecks new installations, preserves cached quotas and does not fabricate percentages or login state',()=>{
 const snapshot={sources:[{id:'codex',label:'Codex',windows:[{id:'seven_day',usedPercent:25}]}]};
 assert.equal(discoverQuotaSources(snapshot).sources[0].availability,'ready');
 const r=discoverQuotaSources(snapshot,{agents:[agent('doubao-work',false)],statuses:{codex:{lastError:{code:'EHTTP'}},doubaoWork:{refreshing:true}}});
 assert.equal(r.sources[0].windows[0].usedPercent,25);assert.equal(r.sources[1].availability,'loading');
 assert.equal(discoverQuotaSources({sources:[]},{agents:[agent('kimi',false)],enabled:false}).sources[0].availability,'disabled');
 assert.equal(discoverQuotaSources({sources:[]},{agents:[]}).empty,true);
});
test('statistics automatically includes installed parsers without quota support and retains existing client variants',()=>{
 const ids=discoverUsageSources(['codex:cli','codex:desktop'],[agent('codex',true),agent('mcode',true,false),agent('kimi',false),{...agent('qoder',true),installed:false}]);
 assert.deepEqual(ids,['codex:cli','codex:desktop','mcode']);
});
