#!/usr/bin/env node
/**
 * 生成 mini（贴边）尺寸档的 8 个动作 SVG。
 *
 * 为什么生成而不是手写：角色几何是**契约**（design/main-state-actions.json
 * 的 characterContract），主形态 38 个动作都遵守它。mini 如果手写一遍
 * 那些 rect，就等于把契约复制了第九份——哪天躯干宽度改了，
 * 主形态会一起改，mini 会静默留在旧几何上。派生就不会。
 *
 * mini 与主形态的唯一区别是**取景**：
 *   主形态 viewBox 45 单位 → 128px 窗口 ≈ 2.84px/单位
 *   mini   viewBox 16 单位 →  48px 窗口 = 3px/单位
 * 角色在屏幕上的实际大小几乎不变，变的是裁掉了场景、只留演员。
 *
 * 用法：node scripts/make-mini-svgs.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** mini 取景：方形，与 48×48 的窗口同比，避免拉伸。 */
const MINI_VIEWBOX = '0 3 16 16';

const ACTIONS = [
  ['mini.idle', 'mini-idle', 'Edge Doze',
    'Tucked against the edge, breathing slowly with one drowsy eye showing.'],
  ['mini.busy', 'mini-busy', 'Edge Bob',
    'Tucked against the edge, bobbing with a working rhythm.'],
  ['mini.peek', 'mini-peek', 'Edge Peek',
    'Leans out from the edge until both eyes clear the frame, then eases back.'],
  ['mini.alert', 'mini-alert', 'Edge Tap',
    'Leans out and taps the edge twice, asking for a decision.'],
  ['mini.error', 'mini-error', 'Edge Slump',
    'Slumps against the edge and rocks slowly, eyes half shut.'],
  ['mini.happy', 'mini-happy', 'Edge Bounce',
    'Springs out from the edge once and settles back.'],
  ['mini.enter', 'mini-enter', 'Tuck In',
    'Slides from the main-form centre into the tucked edge position.'],
  ['mini.exit', 'mini-exit', 'Pop Out',
    'Slides out of the tucked edge position toward the main form.'],
];

function actorMarkup(c) {
  const rect = (id, x, y, w, h) => `<rect id="${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  const legIds = ['outer-left-leg', 'inner-left-leg', 'inner-right-leg', 'outer-right-leg'];
  const legs = c.legsX
    .map((x, i) => rect(legIds[i], x, c.legsY, c.legWidth, c.legHeight))
    .join('');
  const torso = rect('torso', c.torso.x, c.torso.y, c.torso.width, c.torso.height);
  const leftArm = rect('left-arm', c.leftArm.x, c.leftArm.y, c.leftArm.width, c.leftArm.height);
  const rightArm = rect('right-arm', c.rightArm.x, c.rightArm.y, c.rightArm.width, c.rightArm.height);
  const eyes = c.eyesX
    .map((x, i) => rect(i === 0 ? 'left-eye' : 'right-eye', x, c.eyesY, c.eyeWidth, c.eyeHeight))
    .join('');

  // 右爪在贴边位永远被右边界裁掉，所以不给它 motion——
  // 没有对应 keyframes 的元素挂上 motion 只会白付一次合成开销。
  return `<g class="actor motion"><g fill="${c.bodyColor}">${legs}${torso}`
    + `<g class="left-claw motion">${leftArm}</g>`
    + `<g class="right-claw">${rightArm}</g></g>`
    + `<g class="eyes motion blink" fill="${c.eyeColor}">${eyes}</g></g>`;
}

function svg(stateClass, title, desc, actor) {
  return `<?xml-stylesheet type="text/css" href="maclawd-actions.css"?>
<svg xmlns="http://www.w3.org/2000/svg" class="mini state-${stateClass}" viewBox="${MINI_VIEWBOX}" width="480" height="480" shape-rendering="crispEdges">
  <title>Maclawd ${title}</title><desc>${desc}</desc>
  <g class="tuck">${actor}</g>
</svg>
`;
}

async function main() {
  const contractFile = join(ROOT, 'design/main-state-actions.json');
  const { characterContract } = JSON.parse(await readFile(contractFile, 'utf8'));
  if (!characterContract) throw new Error('main-state-actions.json 里没有 characterContract');
  const actor = actorMarkup(characterContract);

  for (const [, stateClass, title, desc] of ACTIONS) {
    const file = join(ROOT, `src/animations/${stateClass}.svg`);
    await writeFile(file, svg(stateClass, title, desc, actor));
  }
  console.log(`生成 ${ACTIONS.length} 个 mini 动作，取景 ${MINI_VIEWBOX}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
