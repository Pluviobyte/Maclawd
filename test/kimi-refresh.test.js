import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,rmSync,existsSync,utimesSync } from 'node:fs';
import { execFileSync,spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readKimiCodeAuth,readKimiCodeQuota } from '../src/runtime/kimi-quota.js';
import { refreshKimiCredential } from '../src/runtime/kimi-refresh.js';

const now=()=>Date.parse('2026-09-20T01:00:00Z');
const initial={access_token:'OLD_ACCESS',refresh_token:'OLD_REFRESH',expires_at:now()/1000-1,expires_in:3600,scope:'coding',token_type:'Bearer'};
async function fixture(fn){const root=mkdtempSync(join(tmpdir(),'maclawd-kimi-refresh-'));const env={MACLAWD_KIMI_CODE_DIR:root,MACLAWD_KIMI_LEGACY_DIR:join(root,'absent')};mkdirSync(join(root,'credentials'));const path=join(root,'credentials/kimi-code.json');writeFileSync(path,JSON.stringify(initial),{mode:0o600});try{await fn({root,path,env});}finally{rmSync(root,{recursive:true,force:true});}}
const tokenResponse=()=>new Response(JSON.stringify({access_token:'NEW_ACCESS',refresh_token:'NEW_REFRESH',expires_in:3600}),{status:200});
test('Kimi proactive refresh shares a flight, uses official directory lock and atomically writes private credentials',()=>fixture(async({root,path,env})=>{
 const auth=await readKimiCodeAuth({env});let calls=0;
 const options={env,now,fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://auth.kimi.com/api/oauth/token');assert.equal(init.redirect,'error');assert.equal(init.body.get('refresh_token'),'OLD_REFRESH');assert.ok(existsSync(join(root,'oauth/kimi-code.lock')));await new Promise(r=>setTimeout(r,20));return tokenResponse();}};
 const values=await Promise.all([refreshKimiCredential(auth,options),refreshKimiCredential(auth,options)]);
 assert.equal(calls,1);assert.ok(values.every(v=>v.token==='NEW_ACCESS'));assert.equal(statSync(path).mode&0o777,0o600);
 const stored=JSON.parse(readFileSync(path));assert.equal(stored.expires_at,now()/1000+3600);assert.equal(stored.scope,'coding');assert.equal(existsSync(join(root,'oauth/kimi-code.lock')),false);
 assert.ok(!JSON.stringify(values).includes('NEW_REFRESH'));
 await refreshKimiCredential(await readKimiCodeAuth({env}),options);assert.equal(calls,1);
}));
test('Kimi refresh failures, concurrent login, logout, malformed response and cancellation never overwrite credentials',()=>fixture(async({path,env})=>{
 const auth=await readKimiCodeAuth({env});const original=readFileSync(path,'utf8');
 for(const response of [new Response('{}',{status:401}),new Response('{}',{status:429}),new Response('{}',{status:500}),new Response('{}')]){
  await assert.rejects(refreshKimiCredential(auth,{env,now,fetchImpl:async()=>response}));assert.equal(readFileSync(path,'utf8'),original);
 }
 const newer={...initial,access_token:'PEER_ACCESS',refresh_token:'PEER_REFRESH',expires_at:now()/1000+5000};
 const value=await refreshKimiCredential(auth,{env,now,fetchImpl:async()=>{writeFileSync(path,JSON.stringify(newer));return tokenResponse();}});
 assert.equal(value.token,'PEER_ACCESS');assert.equal(JSON.parse(readFileSync(path)).refresh_token,'PEER_REFRESH');
 writeFileSync(path,original);await assert.rejects(refreshKimiCredential(auth,{env,now,fetchImpl:async()=>{rmSync(path);return tokenResponse();}}));assert.equal(existsSync(path),false);
 writeFileSync(path,original);const controller=new AbortController();
 await assert.rejects(refreshKimiCredential(auth,{env,now,signal:controller.signal,fetchImpl:async()=>{controller.abort();return tokenResponse();}}),{code:'EABORT'});assert.equal(readFileSync(path,'utf8'),original);
}));
test('Kimi global region refresh and forced refresh after 401 retain the official origin boundary',()=>fixture(async({root,path,env})=>{
 writeFileSync(join(root,'config.toml'),'[providers."managed:kimi-code"]\nbase_url="https://api.kimi.ai/coding/v1"\n[providers."managed:kimi-code".oauth]\noauthHost="https://auth.kimi.ai"\n');
 writeFileSync(path,JSON.stringify({...initial,expires_at:now()/1000+10000}));let api=0,refresh=0;
 const report=await readKimiCodeQuota({env,now,fetchImpl:async(url,init)=>{
  if(url==='https://auth.kimi.ai/api/oauth/token'){refresh++;return tokenResponse();}
  assert.equal(url,'https://api.kimi.ai/coding/v1/usages');api++;
  if(api===1)return new Response('{}',{status:401});
  assert.equal(init.headers.Authorization,'Bearer NEW_ACCESS');return new Response(JSON.stringify({usage:{limit:100,used:25}}));
 }});assert.equal(api,2);assert.equal(refresh,1);assert.match(report.sourceLabel,/海外版/);
 await assert.rejects(readKimiCodeAuth({env:{...env,KIMI_CODE_BASE_URL:'https://api.kimi.com/coding/v1'}}),{code:'EORIGIN'});
}));
test('Kimi reclaims abandoned modern locks but aborts on a changed live lease',()=>fixture(async({root,path,env})=>{
 const lock=join(root,'oauth/kimi-code.lock');mkdirSync(lock,{recursive:true});const stale=new Date(Date.now()-20000);utimesSync(lock,stale,stale);
 const auth=await readKimiCodeAuth({env});await refreshKimiCredential(auth,{env,now,fetchImpl:async()=>tokenResponse()});
 writeFileSync(path,JSON.stringify(initial));
 await assert.rejects(refreshKimiCredential(auth,{env,now,fetchImpl:async()=>{const future=new Date(Date.now()+1000);utimesSync(lock,future,future);return tokenResponse();}}),{code:'ELOCK'});
 assert.equal(JSON.parse(readFileSync(path)).access_token,'OLD_ACCESS');assert.ok(existsSync(lock),'do not remove another lock owner');
}));
test('legacy KIMI_SHARE_DIR uses a native flock lease, releases on EOF and never removes the official lock file',{skip:process.platform!=='darwin'},()=>fixture(async({root,path,env})=>{
 const main=join(root,'main.swift'),binary=join(root,'lock-helper');writeFileSync(main,'import Foundation\nexit(runCredentialLock(path:CommandLine.arguments[2]))\n');
 execFileSync('swiftc',['mac/Sources/Maclawd/CredentialLock.swift',main,'-o',binary]);
 const legacyEnv={MACLAWD_KIMI_CODE_DIR:join(root,'missing'),KIMI_SHARE_DIR:root,MACLAWD_NATIVE_HELPER:binary};
 const auth=await readKimiCodeAuth({env:legacyEnv});assert.equal(auth.refreshContext.legacy,true);
 const lock=join(root,'credentials/kimi-code.lock');
 const result=await refreshKimiCredential(auth,{env:legacyEnv,now,fetchImpl:async()=>{
  // An independent fcntl implementation cannot take the official lock while held.
  const code='import fcntl,sys\nf=open(sys.argv[1],"a+")\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(0)\nsys.exit(1)';
  execFileSync('python3',['-c',code,lock]);return tokenResponse();
 }});assert.equal(result.token,'NEW_ACCESS');assert.ok(existsSync(lock));
 assert.equal(JSON.parse(readFileSync(path)).access_token,'NEW_ACCESS');
}));
