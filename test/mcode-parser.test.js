import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as mcode from '../src/runtime/parsers/mcode.js';
import { scanAll } from '../src/runtime/scan.js';

test('MiniMax 账本独立于 MiMo，缓存写与推理不漏计，WAL 增量和多项目缓存保真', async () => {
  const root=mkdtempSync(join(tmpdir(),'maclawd-mcode-'));
  const keys=['MACLAWD_MCODE_DB','MACLAWD_DATA_DIR'];const before=keys.map(k=>process.env[k]);
  process.env.MACLAWD_MCODE_DB=join(root,'ledger.sqlite');process.env.MACLAWD_DATA_DIR=join(root,'data');
  const db=new DatabaseSync(process.env.MACLAWD_MCODE_DB);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE local_runtime_sessions(session_id TEXT PRIMARY KEY,workspace_dir TEXT,project_workspace_dir TEXT);
    CREATE TABLE local_runtime_token_usage(id INTEGER PRIMARY KEY,session_id TEXT,model TEXT,ts INTEGER,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,raw TEXT);
    INSERT INTO local_runtime_sessions VALUES('a','/scratch/a','/projects/alpha'),('b','/scratch/b','/projects/beta');
    INSERT INTO local_runtime_token_usage VALUES(1,'a','m',1789540000000,10,20,3,7,5,'DO_NOT_READ');`);
  try {
    const first=await scanAll({parsers:[mcode]});const r=first.records[0];
    assert.equal(r.source,'mcode');assert.equal(r.input,10);assert.equal(r.output,23);
    assert.equal(r.reasoning,3);assert.equal(r.cacheRead,7);assert.equal(r.write5m,5);
    assert.equal(JSON.stringify(first).includes('DO_NOT_READ'),false);
    const signature=mcode.discover()[0].cacheKey;
    db.exec("INSERT INTO local_runtime_token_usage VALUES(2,'b','m',1789540010000,11,21,4,8,6,'SECOND_SECRET')");
    assert.notEqual(mcode.discover()[0].cacheKey,signature);
    for(let i=0;i<2;i++) {
      const result=await scanAll({parsers:[mcode]});assert.equal(result.records.length,2);
      assert.deepEqual(result.records.map(r=>r.project),['alpha','beta']);
      assert.equal(result.projectPaths.beta,'/projects/beta');
      assert.equal(result.records.reduce((n,r)=>n+r.output,0),48);
    }
    db.exec('ALTER TABLE local_runtime_token_usage RENAME COLUMN input_tokens TO renamed_input');
    const failed=await scanAll({parsers:[mcode]});
    assert.equal(failed.sourceStatus.mcode.complete,false);
    assert.equal(failed.records.length,2,'schema failure preserves last good records');
  } finally {
    db.close();keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];});rmSync(root,{recursive:true,force:true});
  }
});

test('MiniMax 使用 MCODE_HOME，拒绝相对根而非意外读取其他项目', () => {
  const original = process.env.MCODE_HOME;
  try {
    process.env.MCODE_HOME = '/tmp/isolated-minimax';
    assert.equal(mcode.dbPath(), '/tmp/isolated-minimax/v2/sqlite/runtime-state.sqlite');
    process.env.MCODE_HOME = 'relative';
    assert.throws(() => mcode.dbPath(), /绝对路径/);
  } finally { if (original === undefined) delete process.env.MCODE_HOME; else process.env.MCODE_HOME = original; }
});
