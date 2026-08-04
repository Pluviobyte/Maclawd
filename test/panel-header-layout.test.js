import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelView.swift', import.meta.url), 'utf8',
);

test('双击弹窗顶部 Clawd 保持紧凑，不再占据过大的透明区域', () => {
  const headerHeight = Number(panel.match(/headerHeight:\s*CGFloat\s*=\s*(\d+)/)?.[1]);
  const stage = panel.match(/CharacterStage\([\s\S]*?\.frame\(width:\s*(\d+),\s*height:\s*(\d+)\)/);

  assert.ok(headerHeight <= 120, `顶部区域不应超过 120pt，当前为 ${headerHeight}pt`);
  assert.ok(Number(stage?.[1]) <= 76, `Clawd 透明画布不应超过 76pt，当前为 ${stage?.[1]}pt`);
  assert.ok(Number(stage?.[2]) <= 76, `Clawd 透明画布不应超过 76pt，当前为 ${stage?.[2]}pt`);
  assert.match(panel, /CharacterStage\([\s\S]*?\.allowsHitTesting\(false\)/,
    '顶部 Clawd 仍应只是展示，不能扩大点击范围');
});
