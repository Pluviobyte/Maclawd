import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kimi from '../src/runtime/parsers/kimi-code.js';
import { scanAll } from '../src/runtime/scan.js';
import { displaySource } from '../src/runtime/usage-attribution.js';

test('Kimi desktop + CLI discovery, project index refresh and physical-root deduplication',async()=>{
 const root=mkdtempSync(join(tmpdir(),'maclawd-kimi-desktop-')),old={...process.env};
 Object.assign(process.env,{MACLAWD_DATA_DIR:join(root,'data'),MACLAWD_KIMI_CODE_DIR:join(root,'cli'),MACLAWD_KIMI_LEGACY_DIR:join(root,'legacy'),MACLAWD_KIMI_DESKTOP_DIR:join(root,'desktop')});
 const desktop=join(root,'desktop/daimon-share/daimon/runtime/kimi-code/home');
 const put=(p,v)=>writeFileSync(p,JSON.stringify(v)+'\n');
 try{
  for(const home of [process.env.MACLAWD_KIMI_CODE_DIR,desktop]){
   const sessionDir=join(home,'sessions/project/conv'),dir=join(sessionDir,'agents/main');mkdirSync(dir,{recursive:true});
   put(join(dir,'wire.jsonl'),{type:'usage.record',time:Date.parse('2026-09-20T01:00:00Z'),model:'kimi-for-coding',usage:{inputOther:7,inputCacheRead:2,inputCacheCreation:1,output:3}});
   put(join(home,'session_index.jsonl'),{sessionDir,workDir:'/fixture/project'});
  }
  symlinkSync(desktop,process.env.MACLAWD_KIMI_LEGACY_DIR);
  const scan=()=>scanAll({parsers:[kimi],ignoreSettings:true});
  const cold=await scan();assert.equal(cold.records.length,2);assert.equal(cold.sourceStatus['kimi-code'].discoveredFiles,2);
  assert.deepEqual(new Set(cold.records.map(displaySource)),new Set(['kimi-code:cli','kimi-code:desktop']));
  assert.deepEqual((await scan()).records,cold.records);
  put(join(desktop,'session_index.jsonl'),{sessionDir:join(desktop,'sessions/project/conv'),workDir:'/fixture/renamed'});
  assert.equal((await scan()).records.find(r=>displaySource(r)==='kimi-code:desktop').project,'renamed');
 }finally{process.env=old;rmSync(root,{recursive:true,force:true});}
});
