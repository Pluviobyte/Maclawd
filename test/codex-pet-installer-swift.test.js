import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const nativeTest = process.platform === 'darwin' ? test : test.skip;

nativeTest('the native Codex pet installer validates, installs, updates, and protects collisions', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'maclawd-pet-installer-'));
  const binary = join(scratch, 'pet-installer-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/CodexPetInstaller.swift'),
      join(ROOT, 'mac/Tests/CodexPetInstallerContract.swift'),
      '-framework', 'AppKit',
      '-o', binary,
    ], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(binary, [join(ROOT, 'assets/codex-pet/maclawd')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
