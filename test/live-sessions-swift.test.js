import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('原生实时会话按完整目录分组，并按关注优先级排序', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'maclawd-live-sessions-'));
  const binary = join(scratch, 'live-sessions-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/PanelModel.swift'),
      join(ROOT, 'mac/Sources/Maclawd/WorkBuddyInstallation.swift'),
      join(ROOT, 'mac/Tests/LiveSessionsContract.swift'),
      '-o', binary,
    ], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(binary, [], { cwd: ROOT, stdio: 'pipe' });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
