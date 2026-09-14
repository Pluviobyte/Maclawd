import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const nativeTest = process.platform === 'darwin' ? test : test.skip;

nativeTest('pet window rejects saved positions outside the current display', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'maclawd-pet-position-'));
  const binary = join(scratch, 'panel-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/PetWindowPosition.swift'),
      join(ROOT, 'mac/Tests/PetWindowPositionContract.swift'),
      '-o', binary,
    ], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(binary, [], { cwd: ROOT, stdio: 'pipe' });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
