import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelSettings.swift', import.meta.url), 'utf8',
);
const model = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelModel.swift', import.meta.url), 'utf8',
);

test('设置页允许用户管理 Cursor 本地精确用量 hook，并说明写入与历史边界', () => {
  assert.match(model, /localCapture/);
  assert.match(settings, /agent\.realtime \|\| agent\.localCapture/);
  assert.match(settings, /~\/\.cursor\/hooks\.json/);
  assert.match(settings, /安装后产生的新回合/);
  assert.match(settings, /Cursor/);
});
