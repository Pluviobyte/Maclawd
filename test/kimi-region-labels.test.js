import test from 'node:test';
import assert from 'node:assert/strict';
import { readKimiMembershipQuota, readKimiCodeQuota } from '../src/runtime/kimi-quota.js';

test('Kimi 桌面与 Code 各自按官方登录地区显示，保持单一账户额度身份', async () => {
  for (const [suffix,label] of [['com','国内版'],['ai','海外版']]) {
    for (const [read,host,payload,source] of [
      [readKimiMembershipQuota,'www',{subscriptionBalance:{amountUsedRatio:0.2}},'kimi'],
      [readKimiCodeQuota,'api',{usage:{used:20,limit:100}},'kimi-code'],
    ]) {
      const origin=`https://${host}.kimi.${suffix}`;
      const r=await read({auth:async()=>({token:'fake',origin}),fetchImpl:async(url)=>{
        assert.equal(new URL(url).origin,origin);
        return new Response(JSON.stringify(payload));
      }});
      assert.equal(r.source,source);assert.ok(r.sourceLabel.endsWith(`（${label}）`));
    }
  }
});
