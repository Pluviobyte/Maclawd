import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as dsh from '../src/runtime/parsers/dsh.js';
import { decodeZstdFrames } from '../src/runtime/parsers/zstd-frames.js';
import { scanAll } from '../src/runtime/scan.js';
import { throughput } from '../src/runtime/usage-record.js';
import { readJson } from '../src/runtime/store.js';
const ts=Date.parse('2026-09-16T02:00:00Z');
const usage={inputTokens:10,outputTokens:5,cacheReadTokens:3,cacheWriteTokens:0,reasoningTokens:2,totalTokens:18};
const header=(id,version=3,extra={})=>({type:'session',id,version,createdAt:ts,cwd:'/workspace/'+id,...(version>=2?{isSeeded:false}:{}),...extra});
function turn({retry=false,number=1,model='deepseek-v4',unclosed=false}={}) {
 const e=(type,data={})=>({type,time:ts,data:{turn:number,step:1,...data}});
 const events=[e('turn/start'),e('step/start')];
 if(retry) events.push(e('assistant/attempt',{stream:[{type:'chunk',chunk:{type:'text',text:'PRIVATE_STREAM'}},{type:'chunk',chunk:{type:'usage',usage}},{type:'chunk',chunk:{type:'usage',usage}}]}),e('llm/retry'),e('llm/retry-started'));
 events.push(e('assistant/message',{usage,message:{id:'message-'+number,source:{provider:'deepseek',model},content:'PRIVATE_CONTENT'}}));
 if(!unclosed)events.push(e('step/end'),e('turn/end'));
 return events;
}
const seq=(events,start=0)=>events.map((e,i)=>({...e,seq:start+i}));
const lines=events=>events.map(e=>JSON.stringify(e)+'\n').join('');
const compress=events=>Buffer.concat(events.map(e=>zlib.zstdCompressSync(Buffer.from(JSON.stringify(e)+'\n'))));
async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'maclawd-dsh-')), oldHome=process.env.DSH_HOME, oldData=process.env.MACLAWD_DATA_DIR;
 process.env.DSH_HOME=root;process.env.MACLAWD_DATA_DIR=join(root,'data');
 const write=(id,version,events,compressed=false)=>{
   const dir=join(root,'sessions/project',id);mkdirSync(dir,{recursive:true});
   const path=join(dir,`session${version?'.v'+version:''}.jsonl${compressed?'.zstd':''}`);
   writeFileSync(path,compressed?compress(events):lines(events));return path;
 };
 try{await fn({root,write,scan:()=>scanAll({parsers:[dsh],ignoreSettings:true,budgetMs:60000})});}
 finally{for(const [k,v]of[['DSH_HOME',oldHome],['MACLAWD_DATA_DIR',oldData]])if(v===undefined)delete process.env[k];else process.env[k]=v;rmSync(root,{recursive:true,force:true});}
}
test('DSH independently counts failed/retried attempts exactly once without guessing the failed model',async()=>{
 const parser=dsh.createFileParser({candidate:{version:3}});
 [header('h'),...seq(turn({retry:true}))].forEach(parser.onObject);
 const out=dsh.reconcileSource([{state:(await parser.finish()).state}]);
 assert.equal(out.complete,true);assert.equal(out.records.length,2);assert.equal(out.records.reduce((n,r)=>n+throughput(r),0),36);
 assert.deepEqual(out.records.map(r=>r.model),['unknown','deepseek-v4']);
 assert.ok(out.records.every(r=>r.output===5&&r.reasoning===2));
});
test('DSH rejects invalid totals, missing boundaries, duplicate settlements and unfinished turns as exact totals',()=>{
 const events=seq(turn());events[2].data.usage={...usage,totalTokens:2};
 const p=dsh.createFileParser({candidate:{version:3}});p.onObject(header('bad'));events.forEach(e=>p.onObject(e));
 return p.finish().then(result=>{
  const out=dsh.reconcileSource([{state:result.state}]);assert.equal(out.complete,false);assert.equal(out.records.length,0);
  const pending=dsh.createFileParser({candidate:{version:3}});
  [header('pending'),...seq(turn({unclosed:true}))].forEach(pending.onObject);
  return pending.finish().then(r=>assert.equal(dsh.reconcileSource([{state:r.state}]).complete,false));
 });
});
test('DSH latest generation wins; warm and append scans remain equal; cached metadata contains no body',()=>fixture(async({root,write,scan})=>{
 for(const v of [0,1,2,3]) write('version'+v,v,[header('version'+v,v),...seq(turn())]);
 const file=write('migration',3,[header('migration'),...seq(turn({retry:true}))]);
 write('migration',0,[header('migration',0),...seq(turn())]);
 const first=await scan();assert.equal(first.sourceStatus.dsh.complete,true);assert.equal(first.records.length,6);
 assert.deepEqual((await scan()).records,first.records);
 const second=seq(turn({number:2}),turn({retry:true}).length);appendFileSync(file,lines(second));
 const next=await scan();assert.equal(next.records.length,7);assert.equal(next.stats.appended,1);
 const cache=JSON.stringify(readJson('scan-cache.json',{}));assert.ok(!cache.includes('PRIVATE_STREAM'));assert.ok(!cache.includes('PRIVATE_CONTENT'));
 write('migration',4,[header('migration',4),...seq(turn())]);
 const unsupported=await scan();assert.equal(unsupported.sourceStatus.dsh.complete,false);
 assert.equal(unsupported.records.length,7,'failed replacement generation keeps the last complete source');
 assert.ok(unsupported.warnings.some(w=>w.includes('格式不受支持')));
}));
test('DSH fork prefixes are removed only when parent identities and counts prove the copy',()=>fixture(async({write,scan})=>{
 const inherited=seq(turn()),boundary=inherited.length;
 write('parent',3,[header('parent'),...inherited]);
 const childEvents=[...inherited,{type:'session/end-seed',seq:boundary,time:ts,data:{inherited:true}},...seq(turn({number:2}),boundary+1)];
 write('child',3,[header('child',3,{isSeeded:true,parentSession:'parent'}),...childEvents]);
 const result=await scan();assert.equal(result.records.length,2);assert.equal(result.sourceStatus.dsh.complete,true);
 write('orphan',3,[header('orphan',3,{isSeeded:true,parentSession:'missing'}),...childEvents]);
 const orphan=await scan();assert.equal(orphan.records.length,4);assert.equal(orphan.sourceStatus.dsh.complete,false);
}));
test('DSH migrated inherited prefix needs preserved message identity, not just matching counts',()=>fixture(async({write,scan})=>{
 const inherited=seq(turn());write('parent',0,[header('parent',0),...inherited]);
 const boundary=inherited.length;
 write('child',3,[header('child',3,{isSeeded:true,parentSession:'parent'}),...inherited,{type:'session/end-seed',seq:boundary,time:ts,data:{inherited:true}},...seq(turn({number:2}),boundary+1)]);
 const result=await scan();assert.equal(result.records.length,2);assert.equal(result.sourceStatus.dsh.complete,true);
}));
test('DSH concatenated zstd frames decode all appends and defer a partial tail without hiding corruption',()=>fixture(async({write,scan})=>{
 const events=[header('compressed'),...seq(turn())];const file=write('compressed',3,events,true);
 const first=await scan();assert.equal(first.records.length,1);assert.equal(first.sourceStatus.dsh.complete,true);
 const tail=compress(seq(turn({number:2}),turn().length));
 appendFileSync(file,tail.subarray(0,tail.length-2));
 const partial=await scan();assert.equal(partial.sourceStatus.dsh.complete,false);assert.equal(partial.records.length,1);
 appendFileSync(file,tail.subarray(tail.length-2));
 const complete=await scan();assert.equal(complete.records.length,2);assert.equal(complete.sourceStatus.dsh.complete,true);
 appendFileSync(file,'garbage');const broken=await scan();assert.equal(broken.records.length,2);assert.equal(broken.sourceStatus.dsh.complete,false);
}));
test('Zstd framing handles skippable frames, big blocks and resource limits',()=>{
 const a=zlib.zstdCompressSync(Buffer.alloc(400000,97)),b=zlib.zstdCompressSync(Buffer.from('end'));
 const skip=Buffer.alloc(11);skip.writeUInt32LE(0x184d2a50);skip.writeUInt32LE(3,4);
 const r=decodeZstdFrames(Buffer.concat([a,skip,b]));assert.equal(r.incomplete,false);assert.equal(Buffer.concat(r.chunks).length,400003);
 assert.throws(()=>decodeZstdFrames(a,{maxOutput:10}));
 assert.throws(()=>decodeZstdFrames(Buffer.from('nonsense')),/帧标记/);
});
