import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findClaudeDesktopRoots } from '../src/runtime/claude-roots.js';

test('发现 Claude Desktop Cowork 的私有 .claude 会话根', () => {
  const root = mkdtempSync(join(tmpdir(), 'maclawd-claude-desktop-'));
  const sessionRoot = join(root, 'local-agent-mode-sessions', 'workspace', 'run', 'local_1', '.claude');
  mkdirSync(join(sessionRoot, 'projects'), { recursive: true });
  // 这些目录不是会话数据，不能递归进去制造误报或额外 I/O。
  mkdirSync(join(root, 'local-agent-mode-sessions', 'rpm', 'ignored', '.claude', 'projects'),
    { recursive: true });
  try {
    assert.deepEqual(findClaudeDesktopRoots([root]), [sessionRoot]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
