import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geometryFor, hitBoxFor, normalizeBox, parseViewBox } from '../src/runtime/hit-geometry.js';

const contract = JSON.parse(readFileSync(new URL('../design/main-state-actions.json', import.meta.url), 'utf8')).characterContract;

test('viewBox 解析拒绝坏输入而不是产出 NaN', () => {
  assert.deepEqual(parseViewBox('-15 -25 45 45'), { x: -15, y: -25, width: 45, height: 45 });
  for (const bad of ['', '1 2 3', '1 2 0 4', 'a b c d', null, undefined, '1 2 -3 4']) {
    assert.equal(parseViewBox(bad), null, `坏输入 ${JSON.stringify(bad)} 应返回 null`);
  }
});

test('归一化把 SVG 的 y 向下翻成 AppKit 的 y 向上', () => {
  // 这个翻转错了不会崩，只会让命中区上下颠倒——最难查的那种
  const r = normalizeBox({ x: 0, y: 6, w: 15, h: 9 }, '-15 -25 45 45');
  assert.ok(Math.abs(r.x0 - 1 / 3) < 1e-9);
  assert.ok(Math.abs(r.x1 - 2 / 3) < 1e-9);
  // SVG y6..15（靠上）→ AppKit 应该靠下
  assert.ok(Math.abs(r.y0 - 0.1111111) < 1e-5, `y0=${r.y0}`);
  assert.ok(Math.abs(r.y1 - 0.3111111) < 1e-5, `y1=${r.y1}`);
  assert.ok(r.y0 < r.y1, 'y0 必须是下边界');
});

test('分档表显式声明，不靠前缀猜', () => {
  assert.deepEqual(hitBoxFor('sleeping', contract), contract.hitBoxes.sleeping);
  assert.deepEqual(hitBoxFor('away', contract), contract.hitBoxes.sleeping);
  // idle.drowsy 是站着打瞌睡，前缀猜法会把它归到 idle，但它本来就该用 default
  assert.deepEqual(hitBoxFor('idle.drowsy', contract), contract.hitBoxes.default);
  assert.deepEqual(hitBoxFor('完全没见过的动作', contract), contract.hitBoxes.default);
});

test('sleeping 的命中区确实更扁更宽', () => {
  const stand = geometryFor('idle', contract).hit;
  const lie = geometryFor('sleeping', contract).hit;
  assert.ok(lie.y1 - lie.y0 < stand.y1 - stand.y0, '躺下的命中区应该更矮');
  assert.ok(lie.x1 - lie.x0 > stand.x1 - stand.x0, '躺下的命中区应该更宽');
});

test('可见画面框完全包住命中框', () => {
  const { hit, margin } = geometryFor('idle', contract);
  assert.ok(margin.x0 <= hit.x0 && margin.x1 >= hit.x1);
  assert.ok(margin.y0 <= hit.y0 && margin.y1 >= hit.y1);
});

test('契约残缺时返回 null，而不是算出 NaN 矩形', () => {
  // NaN 矩形传到外壳会让命中判定永远为假——桌宠彻底点不动，且不报错
  assert.equal(geometryFor('idle', null), null);
  assert.equal(geometryFor('idle', { viewBox: '坏的', hitBoxes: contract.hitBoxes }), null);
  assert.equal(normalizeBox({ x: 0, y: 0, w: 0, h: 5 }, '-15 -25 45 45'), null);
});
