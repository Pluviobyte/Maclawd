import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('the native panel decodes the analytics API contract', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'maclawd-panel-contract-'));
  const binary = join(scratch, 'panel-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/PanelModel.swift'),
      join(ROOT, 'mac/Tests/PanelAnalyticsContract.swift'),
      '-o', binary,
    ], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(binary, [], { cwd: ROOT, stdio: 'pipe' });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
