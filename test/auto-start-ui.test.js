import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelSettings.swift', import.meta.url), 'utf8',
);

test('设置页允许用户单独控制 Agent 会话自动启动', () => {
  assert.match(settings, /启动 Agent 时自动打开 Maclawd/);
  assert.match(settings, /bool\("autoStart", default: true\)/);
  assert.match(settings, /setSetting\("autoStart", \$0\)/);
  assert.match(settings, /与「登录时启动」无关/);
});
