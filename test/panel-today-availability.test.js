import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('今天的索引还未产出记录时，不把未知值显示成 0', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'maclawd-today-availability-'));
  const binary = join(scratch, 'today-availability-contract');
  try {
    execFileSync('swiftc', [
      join(ROOT, 'mac/Sources/Maclawd/PanelModel.swift'),
      join(ROOT, 'mac/Tests/PanelTodayAvailabilityContract.swift'),
      '-o', binary,
    ], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(binary, [], { cwd: ROOT, stdio: 'pipe' });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('原生概览和菜单栏在今天数据未知时显示索引状态', () => {
  const panel = readFileSync(join(ROOT, 'mac/Sources/Maclawd/PanelView.swift'), 'utf8');
  const runtime = readFileSync(join(ROOT, 'mac/Sources/Maclawd/RuntimeClient.swift'), 'utf8');
  const menu = readFileSync(join(ROOT, 'mac/Sources/Maclawd/MenuBarController.swift'), 'utf8');

  assert.match(panel, /primaryAvailable/);
  assert.match(panel, /正在索引今天的用量/);
  assert.match(runtime, /throughputAvailable/);
  assert.match(menu, /client\.usage\.throughputAvailable/);
  assert.match(menu, /item\.button\?\.title = " —"/);
});
