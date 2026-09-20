import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as droid from '../src/runtime/parsers/droid.js';
import { scanAll } from '../src/runtime/scan.js';

test('Droid uncached input, catalog, sidecar-only updates, append and malformed snapshot recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-droid-')), old = { ...process.env };
  Object.assign(process.env, { MACLAWD_DATA_DIR: join(root,'data'), MACLAWD_DROID_DIR: join(root,'sessions'), MACLAWD_DROID_SETTINGS: join(root,'settings.json') });
  mkdirSync(process.env.MACLAWD_DROID_DIR);
  const log = join(process.env.MACLAWD_DROID_DIR,'s.jsonl'), side = log.replace('.jsonl','.settings.json');
  const message = JSON.stringify({ type:'message', timestamp:'2026-09-20T01:00:00Z', cwd:'/fixture' })+'\n';
  const settings = { model:'custom:slot-[gw]-0', tokenUsage:{inputTokens:1048,cacheReadTokens:10752,outputTokens:80,thinkingTokens:30,cacheCreationTokens:40} };
  const scan = () => scanAll({parsers:[droid], ignoreSettings:true});
  try {
    writeFileSync(log,message); writeFileSync(side,JSON.stringify(settings));
    writeFileSync(process.env.MACLAWD_DROID_SETTINGS,JSON.stringify({customModels:[{id:settings.model,model:'gpt-5.4',apiKey:'PRIVATE_KEY'}]}));
    const cold = await scan(); const r=cold.records[0];
    assert.equal(r.input,1048);assert.equal(r.cacheRead,10752);assert.equal(r.output,80);assert.equal(r.reasoning,30);assert.equal(r.model,'gpt-5.4');
    assert.ok(!JSON.stringify(cold).includes('PRIVATE_KEY'));
    assert.deepEqual((await scan()).records,cold.records);
    settings.tokenUsage.inputTokens=2345;writeFileSync(side,JSON.stringify(settings));
    assert.equal((await scan()).records[0].input,2345);
    appendFileSync(log,message);settings.tokenUsage.inputTokens=3456;writeFileSync(side,JSON.stringify(settings));
    const appended=await scan();assert.equal(appended.records.length,1);assert.equal(appended.records[0].input,3456);
    writeFileSync(side,'{');const failed=await scan();assert.equal(failed.sourceStatus.droid.complete,false);assert.equal(failed.records[0].input,3456);
    assert.equal(droid.resolveModel('auto'),'droid-auto');
    assert.equal(droid.resolveModel('custom:gpt-5.4-[gateway]-0'),'custom:gpt-5.4-[gateway]-0');
  } finally { process.env=old;rmSync(root,{recursive:true,force:true}); }
});
