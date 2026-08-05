import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../mac/Sources/Maclawd/WorkBuddyInstallation.swift', import.meta.url), 'utf8',
);

test('WorkBuddy 安装识别使用 Launch Services 与官方 bundle identifier', () => {
  assert.match(source, /urlForApplication\(withBundleIdentifier:/);
  assert.match(source, /com\.workbuddy\.workbuddy/);
  assert.doesNotMatch(source, /["'](?:~\/\.workbuddy|\/Applications\/WorkBuddy\.app)/,
    '不能读取数据残留，也不能依赖固定应用路径');
});
