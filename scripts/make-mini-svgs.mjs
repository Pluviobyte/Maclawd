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

/**
 * 从契约读，不写死清单。
 *
 * 原来这里手写了 8 条，新增 mini 动作时必须记得同步——而漏掉的表现是
 * 「契约里有、素材没有」，编排器会回落到别的动作，画面看起来仍然正常。
 */
function actionsFromContract(states) {
  return states.map((s) => [
    s.id,
    s.id.replace('.', '-'),
    s.name,
    s.action,
  ]);
}

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
    // 视线与眨眼必须**嵌套两层**。两个类挂在同一元素上时
    // animation-name 会互相覆盖，只有后者生效——眨眼就没法有自己的周期。
    // 这里曾经是合并写法，靠一次性脚本拆开过；生成器没同步，
    // 于是重新生成时又被覆盖回去。同源的东西必须同源修。
    + `<g class="eyes motion" fill="${c.eyeColor}"><g class="blink motion">${eyes}</g></g></g>`;
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

  const miniDoc = JSON.parse(await readFile(join(ROOT, 'design/mini-actions.json'), 'utf8'));
  const ACTIONS = actionsFromContract(miniDoc.states);

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
