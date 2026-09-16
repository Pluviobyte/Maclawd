import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredApplications, installationEvidence } from '../src/runtime/application-catalog.js';
import { agentConnections } from '../src/runtime/agent-registry.js';

test('应用身份由 Launch Services 精确匹配，未知 bundle 被拒绝，失败不猜测', () => {
  const registered=registeredApplications({platform:'darwin',run:(cmd,args)=>{
    assert.equal(cmd,'/usr/bin/osascript');assert.ok(args.at(-1).includes('URLForApplicationWithBundleIdentifier'));
    return JSON.stringify(['com.minimax.agent','not.in.catalog']);
  }});
  assert.deepEqual([...registered],['com.minimax.agent']);
  assert.deepEqual([...registeredApplications({platform:'darwin',run:()=>{throw new Error('timeout');}})],[]);
  assert.equal(installationEvidence({bundleIds:['com.minimax.agent']},false,registered).installation,'application');
  assert.equal(installationEvidence({bundleIds:['absent']},true,registered).installation,'data-only');
});
test('已识别不等于已支持：普通豆包、Grok Bot 与 SOLO CN 不继承其他产品用量能力', () => {
  const rows=agentConnections({registered:new Set(['com.anysphere.sand','com.bot.pc.doubao','com.work.pc.doubao','cn.trae.solo.app','com.minimax.agent'])});
  for(const id of ['grok-bot','doubao','trae-solo-cn']) {
    const r=rows.find(r=>r.id===id);assert.equal(r.installed,true);assert.equal(r.capabilities.usage,false);
    assert.equal(r.capabilities.quota,false);assert.equal(r.integration.status,'unsupported');
  }
  assert.equal(rows.find(r=>r.id==='doubao-work').capabilities.quota,true);
  assert.equal(rows.find(r=>r.id==='mcode').capabilities.usage,true);
  assert.match(rows.find(r=>r.id==='kiro').label,/CLI/);
});
