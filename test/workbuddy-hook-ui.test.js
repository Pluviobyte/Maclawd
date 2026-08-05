import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelSettings.swift', import.meta.url), 'utf8',
);

test('设置页提供独立的 WorkBuddy 事件增强开关并说明配置与权限边界', () => {
  assert.match(settings, /启用 WorkBuddy 事件增强/);
  assert.match(settings, /workBuddyHookEnhancement/);
  assert.match(settings, /~\/\.workbuddy(?:-ai)?\/settings\.json/);
  assert.match(settings, /不处理权限/);
});
