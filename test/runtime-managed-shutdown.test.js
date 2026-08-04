import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('serve 命令在管理端点关闭服务后退出进程，不留下后台扫描孤儿', () => {
  const source = readFileSync(new URL('../bin/maclawd-usage.js', import.meta.url), 'utf8');
  const serveCommand = source.slice(
    source.indexOf('async function runServe'),
    source.indexOf('// ---------- statusline'),
  );
  assert.match(serveCommand, /started\.server\.once\('close',[\s\S]*process\.exit\(0\)/);
});
