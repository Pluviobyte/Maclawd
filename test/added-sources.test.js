import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as qoder from '../src/runtime/parsers/qoder.js';
import * as qoderCN from '../src/runtime/parsers/qoder-cn.js';
import * as cindy from '../src/runtime/parsers/cindy.js';
import * as cindyGlobal from '../src/runtime/parsers/cindy-global.js';
import * as cola from '../src/runtime/parsers/cola.js';
import * as trae from '../src/runtime/parsers/trae-cli.js';
import { scanAll } from '../src/runtime/scan.js';
import { dedupe } from '../src/runtime/dedupe.js';
import { throughput } from '../src/runtime/usage-record.js';
import { buildRollup, summarize } from '../src/runtime/rollup.js';
import { queryUsageAnalytics } from '../src/runtime/analytics.js';
import { costOf } from '../src/runtime/pricing.js';

const stamp = '2026-09-16T01:00:00.000Z';
const jsonl = values => values.map(v => JSON.stringify(v)).join('\n') + '\n';
async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-new-sources-'));
  const old = { ...process.env };
  process.env.MACLAWD_DATA_DIR = join(root, 'data');
  try { await fn(root); } finally {
    for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old); rmSync(root, { recursive: true, force: true });
  }
}
const scan = parsers => scanAll({ parsers, ignoreSettings: true, budgetMs: 60000 });

test('Qoder regional SQL + CLI snapshots survive cold/warm/append/WAL/schema changes without credits or content', () => fixture(async root => {
  const databases = [];
  for (const [name, env, homeEnv] of [['global','QODER_CONFIG_DIR','QODER_HOME'],['cn','QODERCN_CONFIG_DIR','QODER_CN_HOME']]) {
    process.env[env] = join(root,name,'cli'); process.env[homeEnv] = join(root,name,'ide');
    mkdirSync(join(process.env[env],'projects'),{recursive:true});
    mkdirSync(join(process.env[homeEnv],'cache/db'),{recursive:true});
    const db = new DatabaseSync(join(process.env[homeEnv],'cache/db/local.db')); databases.push(db);
    db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE chat_message(id TEXT,session_id TEXT,role TEXT,gmt_create INTEGER,token_info TEXT,model_info TEXT,content TEXT);`);
    const insert = db.prepare('INSERT INTO chat_message VALUES(?,?,?,?,?,?,?)');
    insert.run('id','s','assistant',Date.parse(stamp),JSON.stringify({prompt_tokens:100,completion_tokens:20,cached_tokens:80}),JSON.stringify({model_key:'auto'}),'PRIVATE_TEXT');
    insert.run('placeholder','s','assistant',Date.parse(stamp),'','','PRIVATE_TEXT');
    writeFileSync(join(process.env[env],'projects/s.jsonl'),jsonl([
      {type:'assistant',timestamp:stamp,sessionId:'s',message:{id:'credits',model:'auto',usage:{credits:42}}},
      {type:'assistant',timestamp:stamp,sessionId:'s',message:{id:'tokens',model:'claude-haiku-4-5',usage:{input_tokens:10,output_tokens:5}}},
    ]));
  }
  try {
    const cold=await scan([qoder,qoderCN]);assert.equal(cold.records.length,4);
    for(const source of ['qoder','qoder-cn']) {
      const r=cold.records.find(r=>r.source===source&&r.model==='qoder-auto');
      assert.equal(r.input,20);assert.equal(r.cacheRead,80);assert.equal(throughput(r),120);
    }
    assert.ok(!JSON.stringify(cold).includes('PRIVATE_TEXT'));
    assert.deepEqual((await scan([qoder,qoderCN])).records,cold.records);
    databases[0].exec(`UPDATE chat_message SET token_info='{"prompt_tokens":120,"completion_tokens":30,"cached_tokens":90}' WHERE id='id'`);
    appendFileSync(join(process.env.QODER_CONFIG_DIR,'projects/s.jsonl'),jsonl([{type:'assistant',timestamp:stamp,sessionId:'s',message:{id:'tokens',model:'claude-haiku-4-5',usage:{input_tokens:10,output_tokens:8}}}]));
    const changed=await scan([qoder,qoderCN]); assert.equal(changed.records.length,4);
    assert.equal(changed.records.filter(r=>r.source==='qoder').reduce((n,r)=>n+throughput(r),0),168);
    databases[0].exec('ALTER TABLE chat_message RENAME COLUMN token_info TO renamed');
    const failed=await scan([qoder,qoderCN]);assert.equal(failed.sourceStatus.qoder.complete,false);
    assert.equal(failed.records.filter(r=>r.source==='qoder').reduce((n,r)=>n+throughput(r),0),168);
  } finally { databases.forEach(db=>db.close()); }
}));

test('Cindy daily ledgers exclude native Claude, sum currencies once, preserve regions and daily resolution', () => fixture(async root => {
 const dbs=[];
 for(const [env,region] of [['MACLAWD_CINDY_DIR','cn'],['MACLAWD_CINDY_GLOBAL_DIR','global']]) {
   process.env[env]=join(root,region);mkdirSync(process.env[env]);
   const db=new DatabaseSync(join(process.env[env],'cindy-owner.db'));dbs.push(db);
   db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE daily_model_usage(day TEXT,agent_kind TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_create_tokens INTEGER,cost_currency TEXT);
   INSERT INTO daily_model_usage VALUES('2026-09-16','codex','gpt-6-astra#billing=subscription',100,20,40,0,'USD'),('2026-09-16','codex','gpt-6-astra#billing=subscription',10,2,4,0,'CNY'),('2026-09-16','claude-code','claude-opus-5',900,900,900,900,'USD');`);
   mkdirSync(join(process.env[env],'backup'));writeFileSync(join(process.env[env],'backup/cindy-old.db'),'not an active ledger');
 }
 try {
   const first=await scan([cindy,cindyGlobal]);assert.equal(first.records.length,2);assert.equal(first.records[0].input,110);
   assert.equal(first.records[0].billing.promptTokens,null);
   const rollup=buildRollup(first.records);
   assert.equal(Object.keys(rollup.slots).length,0);
   assert.equal(summarize(rollup,'all',{priceBucket:costOf}).unpricedTokens,352,'daily prompt cannot select long-context rates');
   const analytics=queryUsageAnalytics(rollup,{range:'today',now:new Date(2026,8,16,8)});
   assert.equal(analytics.totals.totalTokens,352);assert.equal(analytics.records.items[0].resolution,'day');
   assert.equal(analytics.heatmap.reduce((s,r)=>s+r.totalTokens,0),0);assert.equal(analytics.comparison,null);
   assert.match(analytics.resolutionNote,/日账本/);
   const hourly=queryUsageAnalytics(rollup,{range:'24h',now:new Date(2026,8,16,8)});
   assert.equal(hourly.totals.totalTokens,0);assert.match(hourly.resolutionNote,/未计入/);
   dbs[0].exec('UPDATE daily_model_usage SET input_tokens=200 WHERE cost_currency=\'USD\'');
   const updated=await scan([cindy,cindyGlobal]);assert.equal(updated.records.find(r=>r.source==='cindy').input,210);
   assert.deepEqual((await scan([cindy,cindyGlobal])).records,updated.records);
   assert.equal(cindy.localDay('2026-02-30'),null);
   process.env.MACLAWD_CODEX_HOME=join(process.env.MACLAWD_CINDY_DIR,'codex-home');
   mkdirSync(join(process.env.MACLAWD_CODEX_HOME,'sessions'),{recursive:true});
   const nativeOwned=await scan([cindy,cindyGlobal]);
   assert.equal(nativeOwned.records.length,1);assert.equal(nativeOwned.records[0].source,'cindy-global');
 } finally { dbs.forEach(db=>db.close()); }
}));

test('Cola copied histories dedupe stable records but retain newly added calls and short-id collisions', () => fixture(async root => {
 process.env.COLA_DATA_DIR=root;mkdirSync(join(root,'sessions'));
 const entry=(id,ts,parentId='p')=>({type:'message',id,parentId,timestamp:ts,message:{role:'assistant',model:'claude-haiku-4-5',usage:{input:10,output:7,reasoning:2,cacheRead:5,cacheWrite:4,cacheWrite1h:4}}});
 const original=entry('a',stamp);
 for(const [name,date,extra] of [['original',stamp,[]],['copy','2026-09-17T00:00:00Z',[entry('b',stamp),entry('a','2026-09-17T00:00:00Z')]]]) {
  writeFileSync(join(root,'sessions',name+'.jsonl'),jsonl([{type:'session',id:name,timestamp:date,cwd:'/projects/'+name},original,...extra]));
 }
 const result=await scan([cola]);assert.equal(result.records.length,3);
 const first=result.records.find(r=>JSON.parse(r.messageId)[0]==='a'&&r.ts===Date.parse(stamp));assert.equal(first.project,'original');
 assert.equal(first.write1h,4);assert.equal(first.write5m,0);assert.equal(first.output,7);assert.equal(throughput(first),26);
 assert.deepEqual((await scan([cola])).records,result.records);
 assert.ok(summarize(buildRollup(result.records),'all',{priceBucket:costOf}).cost>0);
}));

test('Trae microseconds, primary/failover selection and reasoning remain correct through append reset', () => fixture(async root => {
 process.env.MACLAWD_TRAE_CLI_DIR=root;mkdirSync(join(root,'session'));
 const path=join(root,'session/traces.jsonl');writeFileSync(join(root,'session/session.json'),JSON.stringify({metadata:{cwd:'/project',model_name:'fallback'}}));
 const span=(id,category,input=10)=>({spanID:id,traceID:'same-session',startTime:Date.parse(stamp)*1000,tags:[{key:'span.category',value:category},{key:'usage.input_tokens',value:input},{key:'usage.output_tokens',value:4},{key:'usage.reasoning_tokens',value:3},{key:'model.name',value:'reported'}]});
 writeFileSync(path,jsonl([span('outer','model.call'),span('real','model.real_call')]));
 const first=await scan([trae]);assert.equal(first.records.length,1);assert.equal(first.records[0].output,7);
 appendFileSync(path,jsonl([span('one','model.stream.eino'),span('one','model.stream.eino',20),span('two','model.stream.eino'),span('failover','model.generate')]));
 const next=await scan([trae]);assert.equal(next.records.length,3);assert.equal(next.records.reduce((n,r)=>n+r.input,0),40);
 assert.ok(next.records.every(r=>r.ts===Date.parse(stamp)&&r.model==='reported'));
 assert.deepEqual((await scan([trae])).records,next.records);
 writeFileSync(path,jsonl([span('two','model.stream.eino')]));assert.equal((await scan([trae])).records.length,1);
}));

test('unknown cache TTL does not silently use the 5m price; Cindy billing marker is an exact alias',()=>{
 const r={source:'cola',model:'claude-haiku-4-5#billing=api',ts:Date.parse(stamp),input:10,output:5,cacheRead:0,write5m:2,write1h:0,reasoning:0,billing:{unknownWriteTTL:true}};
 assert.equal(summarize(buildRollup([r]),'all',{priceBucket:costOf}).cost,null);
 r.billing.unknownWriteTTL=false;assert.ok(summarize(buildRollup([r]),'all',{priceBucket:costOf}).cost>0);
});
