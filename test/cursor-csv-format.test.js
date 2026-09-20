import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCursorUsageCsv } from '../src/runtime/parsers/cursor.js';
test('Cursor schema drift errors differ from a valid empty CSV; aliases remain supported', () => {
  for(const text of ['', '<html>Sign in</html>', 'Date,Model,NewCounter\n2026-09-20,test,10', 'Date,Output Tokens\n2026-09-20,10']) {
    assert.throws(()=>parseCursorUsageCsv(text),{code:'EFORMAT'});
  }
  assert.deepEqual(parseCursorUsageCsv('Date,Model,Output Tokens\n'),[]);
  const result=parseCursorUsageCsv('timestamp,model,prompt_tokens,completion_tokens\n2026-09-20T01:00:00Z,gpt-5.4,10,5\n');
  assert.equal(result[0].input,10);assert.equal(result[0].output,5);
});
