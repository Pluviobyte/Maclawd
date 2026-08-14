import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = resolve(import.meta.dirname, '..');
const nativeTest = process.platform === 'darwin' ? test : test.skip;

test('实时会话标题旁必须解释「为什么我的窗口不在这里」', () => {
  // 一个正在跑的会话没出现在这里，是个没有任何线索的现象——用户唯一
  // 能得出的结论是「它坏了」。这颗 ⓘ 是那条线索，必须指到具体的开关。
  const panel = readFileSync(join(ROOT, 'mac/Sources/Maclawd/PanelView.swift'), 'utf8');
  const page = panel.slice(
    panel.indexOf('private struct SessionsPage'),
    panel.indexOf('private var projectGroups'),
  );
  assert.match(page, /Text\("实时会话"\)[\s\S]{0,200}InfoDot\(/,
    'ⓘ 应当紧跟在「实时会话」标题右侧');
  assert.match(page, /channelInfo[\s\S]*设置 → Agent 连接/,
    '说明必须指出具体去哪儿打开，而不是泛泛地说「需要连接」');
  assert.match(page, /channelInfo[\s\S]*稳定/);
});

nativeTest('原生实时会话按完整目录分组，并按关注优先级排序', () => {
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
