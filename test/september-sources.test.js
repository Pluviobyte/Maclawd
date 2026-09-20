import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,mkdirSync,writeFileSync,appendFileSync,rmSync,copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,delimiter } from 'node:path';
import * as codebuddy from '../src/runtime/parsers/codebuddy.js';
import * as codearts from '../src/runtime/parsers/codearts-agent.js';
import * as devin from '../src/runtime/parsers/devin.js';
import { scanAll } from '../src/runtime/scan.js';
import { parsers } from '../src/runtime/parsers/index.js';
import { discoverUsageSources, QUOTA_SOURCE_IDS } from '../src/runtime/tool-discovery.js';
const ts=Date.parse('2026-09-20T01:00:00Z');
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'maclawd-sep-sources-')),old={...process.env};process.env.MACLAWD_DATA_DIR=join(root,'data');try{await fn(root);}finally{process.env=old;rmSync(root,{recursive:true,force:true});}}
const scan=parser=>scanAll({parsers:[parser],ignoreSettings:true});
test('CodeBuddy call identity fallback, cache writes, project, copies and new request within one turn',()=>fixture(async root=>{
 process.env.MACLAWD_CODEBUDDY_DIR=root;mkdirSync(join(root,'projects'));
 const row={timestamp:ts,sessionId:'s',cwd:'/fixture/project',message:{role:'assistant',id:'',usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:20,cache_creation_input_tokens:3}},providerData:{messageId:'m1',requestModelId:'auto',conversationRequestId:'turn'},content:'PRIVATE_BODY'};
 const file=join(root,'projects/s.jsonl');writeFileSync(file,JSON.stringify(row)+'\n');copyFileSync(file,join(root,'projects/copy.jsonl'));
 let result=await scan(codebuddy);assert.equal(result.records.length,1);assert.equal(result.records[0].model,'codebuddy-auto');assert.equal(result.records[0].write5m,3);assert.equal(result.records[0].input,10);
 assert.ok(!JSON.stringify(result).includes('PRIVATE_BODY'));
 row.providerData.messageId='m2';appendFileSync(file,JSON.stringify(row)+'\n');
 assert.equal((await scan(codebuddy)).records.length,2);
}));
test('Devin reads WAL and per-message metrics, dedupes nodes, separates projects and preserves failed schema',()=>fixture(async root=>{
 process.env.MACLAWD_DEVIN_DB=join(root,'sessions.db');const db=new DatabaseSync(process.env.MACLAWD_DEVIN_DB);
 try{
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sessions(id TEXT,working_directory TEXT,model TEXT); CREATE TABLE message_nodes(row_id INTEGER,session_id TEXT,created_at INTEGER,chat_message TEXT); INSERT INTO sessions VALUES('s','/fixture/one','unknown'),('s2','/fixture/two','unknown')");
  const message={message_id:'m',role:'assistant',content:'PRIVATE_BODY',metadata:{generation_model:'gpt-5.4',metrics:{input_tokens:10,output_tokens:5,cache_read_tokens:20,cache_creation_tokens:3}}};
  const insert=db.prepare('INSERT INTO message_nodes VALUES(?,?,?,?)');insert.run(1,'s',ts/1000,JSON.stringify(message));insert.run(2,'s',ts/1000,JSON.stringify(message));insert.run(3,'s2',ts/1000,JSON.stringify(message));
  const cold=await scan(devin);assert.equal(cold.records.length,2);assert.deepEqual(new Set(cold.records.map(r=>r.project)),new Set(['one','two']));
  assert.equal(cold.records[0].write5m,3);assert.ok(!JSON.stringify(cold).includes('PRIVATE_BODY'));assert.deepEqual((await scan(devin)).records,cold.records);
  message.metadata.metrics.input_tokens=30;db.prepare('UPDATE message_nodes SET chat_message=?').run(JSON.stringify(message));assert.equal((await scan(devin)).records[0].input,30);
  db.exec('ALTER TABLE message_nodes RENAME COLUMN chat_message TO renamed');const failed=await scan(devin);assert.equal(failed.sourceStatus.devin.complete,false);assert.equal(failed.records[0].input,30);
 }finally{db.close();}
}));
test('CodeArts multiple profiles and child calls count once; cache and reasoning use Maclawd contract',()=>fixture(async root=>{
 const dirs=[join(root,'one'),join(root,'two')];dirs.forEach(dir=>mkdirSync(dir));process.env.MACLAWD_CODEARTS_AGENT_DIRS=dirs.join(delimiter);
 for(const dir of dirs){const db=new DatabaseSync(join(dir,'opencode.db'));try{
  db.exec("CREATE TABLE session(id TEXT,parent_id TEXT,directory TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO session VALUES('parent',NULL,'/fixture/project'),('child','parent','/child')");
  const insert=db.prepare('INSERT INTO message VALUES(?,?,?,?)');const data={role:'assistant',modelID:'claude-sonnet-4-6',content:'PRIVATE_BODY',tokens:{input:10,output:5,reasoning:2,cache:{read:20,write:3}}};
  insert.run('m1','parent',ts,JSON.stringify(data));insert.run('m2','child',ts,JSON.stringify(data));
 }finally{db.close();}}
 const cold=await scan(codearts);assert.equal(cold.records.length,2);assert.equal(cold.records[0].output,7);assert.equal(cold.records[0].reasoning,2);assert.equal(cold.records[0].write5m,3);assert.ok(cold.records.every(r=>r.project==='project'));
 assert.ok(!JSON.stringify(cold).includes('PRIVATE_BODY'));assert.deepEqual((await scan(codearts)).records,cold.records);
 const ids=['codebuddy','codearts-agent','devin'];assert.ok(ids.every(id=>parsers.some(p=>p.id===id)));
 assert.deepEqual(discoverUsageSources([],ids.map(id=>({id,installed:true,capabilities:{usage:true}}))),[...ids].sort());assert.ok(ids.every(id=>!QUOTA_SOURCE_IDS.has(id)));
}));
