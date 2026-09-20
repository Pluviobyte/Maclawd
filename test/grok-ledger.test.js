import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as grok from '../src/runtime/parsers/grok.js';
import { scanAll } from '../src/runtime/scan.js';
import { throughput } from '../src/runtime/usage-record.js';

test('Grok official ledger: original turn time, inclusive totals, forks, dual logs, updates and failures', async () => {
  const root=mkdtempSync(join(tmpdir(),'maclawd-grok-ledger-')),old={...process.env};
  process.env.MACLAWD_DATA_DIR=join(root,'data');process.env.MACLAWD_GROK_DIR=root;
  const put=(p,v)=>writeFileSync(p,JSON.stringify(v)+'\n');
  const turn={turnNumber:1,endedAt:'2026-09-19T01:00:00Z',inputTokens:100,outputTokens:50,cachedReadTokens:20,cacheCreationTokens:10,reasoningTokens:10,totalTokens:150};
  const make=(id,parent)=>{
    const dir=join(root,'sessions','project',id);mkdirSync(dir,{recursive:true});
    put(join(dir,'summary.json'),{info:{id,cwd:'/fixture'},current_model_id:'grok-4.6',parent_session_id:parent});
    put(join(dir,'updates.jsonl'),{timestamp:1790000010,params:{sessionId:id,update:{sessionUpdate:'turn_completed',usage:turn}}});
    put(join(dir,'usage.json'),{turns:[turn]});return dir;
  };
  const scan=()=>scanAll({parsers:[grok],ignoreSettings:true});
  try {
    const dir=make('parent');make('fork','parent');
    const cold=await scan();assert.equal(cold.sourceStatus.grok.complete,true);assert.equal(cold.records.length,1);
    assert.equal(cold.records[0].ts,Date.parse(turn.endedAt));assert.equal(throughput(cold.records[0]),150);assert.equal(cold.records[0].reasoning,10);
    assert.deepEqual((await scan()).records,cold.records);
    put(join(dir,'usage.json'),{turns:[turn,{...turn,turnNumber:2,endedAt:'2026-09-20T01:00:00Z'}]});
    assert.equal((await scan()).records.length,2);
    put(join(dir,'usage.json'),{turns:[{...turn,usageIsIncomplete:true}]});
    const partial=await scan();assert.equal(partial.sourceStatus.grok.complete,false);assert.equal(partial.records.length,2);
    writeFileSync(join(dir,'usage.json'),'{');assert.equal((await scan()).records.length,2);
    rmSync(join(dir,'usage.json'));put(join(dir,'updates.jsonl'),{timestamp:1790000010,params:{update:{sessionUpdate:'turn_completed'}}});
    const unknown=await scan();assert.equal(unknown.sourceStatus.grok.complete,false);assert.equal(unknown.records.length,2);
  }finally{process.env=old;rmSync(root,{recursive:true,force:true});}
});
