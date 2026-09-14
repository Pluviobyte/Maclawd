import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const nativeTest = process.platform === 'darwin' ? test : test.skip;

nativeTest('WebKit body and limb contours exclude transparent gaps in main and mini modes', { timeout: 60000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'maclawd-pet-hit-'));
  const binary = join(scratch, 'pet-hit-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/PetHitRegion.swift'),
      join(ROOT, 'mac/Sources/Maclawd/CharacterRenderer.swift'),
      join(ROOT, 'mac/Tests/PetHitRegionContract.swift'),
      '-o', binary,
    ], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(binary, [ROOT], { cwd: ROOT, stdio: 'pipe', timeout: 45000 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
