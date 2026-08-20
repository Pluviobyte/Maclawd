import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AUTO_START_SUPPRESSION_FILE } from '../src/runtime/auto-start.js';

const SOURCE = resolve('mac/Sources/Maclawd/AutoStartSuppression.swift');

test('Swift 退出标记与 hook 共用同一份契约', {
  skip: !existsSync('/usr/bin/swiftc') && '当前 runner 未安装 Swift 编译器',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-auto-start-'));
  const harness = join(dir, 'main.swift');
  const binary = join(dir, 'test-auto-start-suppression');
  writeFileSync(harness, `
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
switch CommandLine.arguments[2] {
case "suppress": try AutoStartSuppression.suppress(in: directory)
case "clear": try AutoStartSuppression.clear(in: directory)
default: fatalError("unknown command")
}
`, 'utf8');

  try {
    execFileSync('/usr/bin/swiftc', [SOURCE, harness, '-o', binary], { stdio: 'pipe' });
    const marker = join(dir, AUTO_START_SUPPRESSION_FILE);

    execFileSync(binary, [dir, 'suppress']);
    assert.equal(existsSync(marker), true, '原生退出必须写出 hook 识别的标记');

    execFileSync(binary, [dir, 'clear']);
    assert.equal(existsSync(marker), false, '用户自己再打开后应恢复自动启动资格');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
