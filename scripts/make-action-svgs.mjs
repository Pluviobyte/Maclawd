#!/usr/bin/env node
/**
 * 生成重做过的主形态动作 SVG。
 *
 * 和 make-mini-svgs.mjs 同一个理由：角色几何是契约，手写等于把它再复制一份。
 * 这里多解决两个结构问题，都是重做运动时才暴露出来的：
 *
 * 1. **眼睛与眨眼必须分成嵌套两层。** 现有素材写的是
 *    `<g class="eyes motion blink">`——两个类挂在同一个元素上，
 *    于是 `.eyes` 和 `.blink` 的 animation-name 互相覆盖，只有后者生效。
 *    这就是为什么旧动作里眨眼只能塞进视线的关键帧里，没法有自己的周期。
 *    拆成 `.eyes` 包住 `.blink` 之后，视线和眨眼才能各走各的拍子。
 *
 * 2. **四条腿要能各自分组。** 旧的 leg_shuffle 只分了两组，
 *    另外两条腿被钉在躯干上，动作读起来是「半边在挪」。
 *
 * 用法：node scripts/make-action-svgs.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ANIMATIONS } from '../design/motion-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWBOX = '-15 -25 45 45';
const LEG_CLASSES = ['leg-a', 'leg-b', 'leg-c', 'leg-d'];
const LEG_IDS = ['outer-left-leg', 'inner-left-leg', 'inner-right-leg', 'outer-right-leg'];

const rect = (id, x, y, w, h) => `<rect id="${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;

function actor(c, { splitLegs = false } = {}) {
  const legs = c.legsX.map((x, i) => {
    const r = rect(LEG_IDS[i], x, c.legsY, c.legWidth, c.legHeight);
    // 只有需要逐条驱动的动作才分组——多余的分组是白付的合成开销
    return splitLegs ? `<g class="${LEG_CLASSES[i]} motion">${r}</g>` : r;
  }).join('');

  return `<g class="actor motion"><g fill="${c.bodyColor}">${legs}`
    + rect('torso', c.torso.x, c.torso.y, c.torso.width, c.torso.height)
    + `<g class="left-claw motion">${rect('left-arm', c.leftArm.x, c.leftArm.y, c.leftArm.width, c.leftArm.height)}</g>`
    + `<g class="right-claw motion">${rect('right-arm', c.rightArm.x, c.rightArm.y, c.rightArm.width, c.rightArm.height)}</g>`
    + '</g>'
    // 视线在外、眨眼在内：两层才能有各自的周期
    + `<g class="eyes motion" fill="${c.eyeColor}"><g class="blink motion">`
    + rect('left-eye', c.eyesX[0], c.eyesY, c.eyeWidth, c.eyeHeight)
    + rect('right-eye', c.eyesX[1], c.eyesY, c.eyeWidth, c.eyeHeight)
    + '</g></g></g>';
}

async function main() {
  const contractFile = join(ROOT, 'design/main-state-actions.json');
  const { characterContract: c } = JSON.parse(await readFile(contractFile, 'utf8'));
  if (!c) throw new Error('main-state-actions.json 里没有 characterContract');

  let count = 0;
  for (const anim of ANIMATIONS) {
    if (!anim.svg) continue;
    const { file, title, desc, props = '', propsAfter = '', splitLegs } = anim.svg;
    // props 画在角色**之前**（在身后），propsAfter 画在**之后**（在身前）。
    // 「拿在手里」的道具必须在身前，画在身后会被躯干挡掉一半。
    const body = `${props}${actor(c, { splitLegs })}${propsAfter}`;
    const svg = `<?xml-stylesheet type="text/css" href="maclawd-actions.css"?>
<svg xmlns="http://www.w3.org/2000/svg" class="state-${anim.state}" viewBox="${VIEWBOX}" width="500" height="500" shape-rendering="crispEdges">
  <title>Maclawd ${title}</title><desc>${desc}</desc>
  ${body}
</svg>
`;
    await writeFile(join(ROOT, 'src/animations', file), svg);
    count++;
  }
  console.log(`生成 ${count} 个主形态动作 SVG`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
