import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('自定义日期 sheet 内的取消和应用不会被当成面板外点击', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-panel-window-scope-'));
  const binary = join(dir, 'panel-window-scope-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/PanelWindowScope.swift'),
      join(ROOT, 'mac/Tests/PanelWindowScopeContract.swift'),
      '-o', binary,
    ], { stdio: 'pipe' });
    execFileSync(binary, { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
