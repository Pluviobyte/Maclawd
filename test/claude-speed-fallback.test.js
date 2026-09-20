import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObject } from '../src/runtime/parsers/claude-code.js';
test('Claude message.speed fallback preserves authoritative usage speed and model identity',()=>{
 const obj={type:'assistant',timestamp:'2026-09-20T01:00:00Z',message:{model:'claude-opus-5',speed:'fast',usage:{input_tokens:10,output_tokens:5}}};
 assert.equal(parseObject(obj).billing.serviceTier,'fast');assert.equal(parseObject(obj).model,'claude-opus-5');
 obj.message.usage.speed='standard';assert.equal(parseObject(obj).billing.serviceTier,'standard');
});
