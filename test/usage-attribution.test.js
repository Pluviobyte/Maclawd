import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { displaySource, pathAttribution, codexAttribution } from '../src/runtime/usage-attribution.js';
import { buildRollup } from '../src/runtime/rollup.js';
import { scanAll } from '../src/runtime/scan.js';
import * as claude from '../src/runtime/parsers/claude-code.js';
import * as codex from '../src/runtime/parsers/codex.js';

const dimensions = rollup => ({ sources: [...new Set(Object.values(rollup.days).flatMap(d=>Object.keys(d.sources)))] });
const row = (id, ts) => ({type:'assistant', timestamp:ts, message:{id, model:'m',usage:{input_tokens:10,output_tokens:2}},requestId:id});
test('路径归属区分 Cowork、Antigravity CLI 和扩展宿主，未知路径不猜测', () => {
  assert.equal(pathAttribution('claude-code','/Claude/local-agent-mode-sessions/x/.claude/projects/x'), 'claude-code:cowork');
  assert.equal(pathAttribution('claude-code','/custom/projects/x'), 'claude-code:local');
  assert.equal(pathAttribution('antigravity','/h/.gemini/antigravity-cli/conversations/a.db'), 'antigravity:cli');
  assert.equal(pathAttribution('cline','/h/Trae CN/User/globalStorage/saoudrizwan.claude-dev/tasks/x'), 'cline:host:Trae CN');
  assert.equal(pathAttribution('roo-code','/custom/unknown'), null);
  assert.equal(displaySource({source:'codex',usageSource:'claude-code:cowork'}), 'codex');
});
test('Codex 使用明确元数据，桌面优先于默认 vscode 通道，未知入口不伪装成 CLI', () => {
  assert.equal(codexAttribution({originator:'Codex Desktop',source:'vscode'}), 'codex:desktop');
  assert.equal(codexAttribution({originator:'Claude Code',source:'vscode'}), 'codex:integration');
  assert.equal(codexAttribution({source:'cli'}), 'codex:cli');
  assert.equal(codexAttribution({source:'custom'}), null);
});
test('归属在去重后展示，冷扫、缓存、追加读总量一致，副本不双计', async () => {
  const root=mkdtempSync(join(tmpdir(),'maclawd-attribution-'));
  const keys=['MACLAWD_DATA_DIR','MACLAWD_CLAUDE_DIRS'];const before=keys.map(k=>process.env[k]);
  const code=join(root,'code'),cowork=join(root,'local-agent-mode-sessions','x','.claude');
  process.env.MACLAWD_DATA_DIR=join(root,'data');process.env.MACLAWD_CLAUDE_DIRS=[code,cowork].join(':');
  for(const dir of [code,cowork])mkdirSync(join(dir,'projects','project'),{recursive:true});
  const codeFile=join(code,'projects/project/a.jsonl'),coworkFile=join(cowork,'projects/project/b.jsonl');
  writeFileSync(codeFile,JSON.stringify(row('call1','2026-09-16T10:00:00Z'))+'\n');
  writeFileSync(coworkFile,JSON.stringify(row('call1','2026-09-16T10:00:00Z'))+'\n'+JSON.stringify(row('call2','2026-09-16T11:00:00Z'))+'\n');
  try {
    for(let i=0;i<2;i++) {
      const result=await scanAll({parsers:[claude]});
      assert.equal(result.records.length,2);
      assert.equal(result.records.reduce((n,r)=>n+r.input,0),20);
      const rollup=buildRollup(result.records,result.sessionsBySource);
      assert.ok(dimensions(rollup).sources.includes('claude-code:cowork'));
      assert.ok(result.records.every(r=>r.usageSource));
    }
    appendFileSync(codeFile,JSON.stringify(row('call3','2026-09-16T12:00:00Z'))+'\n');
    const result=await scanAll({parsers:[claude]});assert.equal(result.records.length,3);
    assert.ok(result.records.some(r=>r.messageId==='call3'&&r.usageSource==='claude-code:local'));
  } finally {keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];});rmSync(root,{recursive:true,force:true});}
});
test('Codex accounting 重建保留入口，rollup 不重复增加账户额度', async () => {
  const root=mkdtempSync(join(tmpdir(),'maclawd-codex-origin-'));
  const keys=['MACLAWD_DATA_DIR','MACLAWD_CODEX_HOME'];const before=keys.map(k=>process.env[k]);
  process.env.MACLAWD_DATA_DIR=join(root,'data');process.env.MACLAWD_CODEX_HOME=join(root,'codex');
  mkdirSync(join(root,'codex/sessions'),{recursive:true});
  const ts='2026-09-16T10:00:00Z';
  for(const [id,source,originator] of [['a','cli','codex-tui'],['b','vscode','Codex Desktop']]) {
    const rows=[{type:'session_meta',timestamp:ts,payload:{id,source,originator,timestamp:ts}},
      {type:'event_msg',timestamp:ts,payload:{type:'token_count',info:{last_token_usage:{input_tokens:10,output_tokens:2},total_token_usage:{input_tokens:10,output_tokens:2,total_tokens:12}}}}];
    writeFileSync(join(root,`codex/sessions/${id}.jsonl`),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
  }
  try {for(let i=0;i<2;i++) {const result=await scanAll({parsers:[codex]});assert.deepEqual(dimensions(buildRollup(result.records)).sources.sort(),['codex:cli','codex:desktop']);}}
  finally {keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];});rmSync(root,{recursive:true,force:true});}
});
