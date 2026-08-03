#!/usr/bin/env node
/**
 * 把 design/candidates/ 下手工设计的候选变成可播放的素材与 CSS。
 *
 * 与 build-variants.mjs 的分工：
 *   build-variants   参数化变体（同一个设计的五种调法），不产生新素材
 *   build-candidates 手工设计（每个换掉一条不同的轴），**每个都是新素材**
 *
 * 后者才是「设计」，前者只是「调参」。两者都保留，因为它们回答的问题不同：
 * 变体问「这个设计要不要更夸张」，候选问「要不要换一个设计」。
 *
 * 用法：node scripts/build-candidates.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadCandidates } from '../design/candidates/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'src/animations/maclawd-actions.css');
const BEGIN = '/* === 手工候选：由 scripts/build-candidates.mjs 生成，请勿手改 === */';
const END = '/* === 手工候选区结束 === */';
const VIEWBOX = '-15 -25 45 45';

const LEG_CLASSES = ['leg-a', 'leg-b', 'leg-c', 'leg-d'];
const LEG_IDS = ['outer-left-leg', 'inner-left-leg', 'inner-right-leg', 'outer-right-leg'];
const rect = (id, x, y, w, h) => `<rect id="${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;

/** 角色标记由契约派生，与 make-action-svgs.mjs 保持同一套几何。 */
function actor(c, { splitLegs = false } = {}) {
  const legs = c.legsX.map((x, i) => {
    const r = rect(LEG_IDS[i], x, c.legsY, c.legWidth, c.legHeight);
    return splitLegs ? `<g class="${LEG_CLASSES[i]} motion">${r}</g>` : r;
  }).join('');
  return `<g class="actor motion"><g fill="${c.bodyColor}">${legs}`
    + rect('torso', c.torso.x, c.torso.y, c.torso.width, c.torso.height)
    + `<g class="left-claw motion">${rect('left-arm', c.leftArm.x, c.leftArm.y, c.leftArm.width, c.leftArm.height)}</g>`
    + `<g class="right-claw motion">${rect('right-arm', c.rightArm.x, c.rightArm.y, c.rightArm.width, c.rightArm.height)}</g>`
    + '</g>'
    // 视线与眨眼必须嵌套两层，否则 animation-name 互相覆盖，眨眼没法有自己的周期
    + `<g class="eyes motion" fill="${c.eyeColor}"><g class="blink motion">`
    + rect('left-eye', c.eyesX[0], c.eyesY, c.eyeWidth, c.eyeHeight)
    + rect('right-eye', c.eyesX[1], c.eyesY, c.eyeWidth, c.eyeHeight)
    + '</g></g></g>';
}

/** 权重 → 百分比。与 build-motion-css.mjs 同一套算法，必须保持一致。 */
function distribute(poses) {
  const total = poses.reduce((n, [, w]) => n + w, 0);
  const out = [];
  let acc = 0;
  for (let i = 0; i < poses.length; i++) {
    const [decl, weight] = poses[i];
    const start = Math.round((acc / total) * 100);
    acc += weight;
    const end = i === poses.length - 1 ? 100 : Math.max(start, Math.round((acc / total) * 100) - 1);
    out.push(`${start}%,${end}%{${decl.includes(':') ? decl : `transform:${decl}`}}`);
  }
  return out.join(' ');
}

async function main() {
  const candidates = await loadCandidates();
  if (!candidates.length) {
    console.log('design/candidates/ 下还没有候选');
    return;
  }
  const { characterContract: c } = JSON.parse(
    await readFile(join(ROOT, 'design/main-state-actions.json'), 'utf8'),
  );

  const blocks = [];
  const catalog = [];
  for (const cand of candidates) {
    const state = cand.id;
    const body = `${cand.props ?? ''}${actor(c, { splitLegs: cand.splitLegs })}${cand.propsAfter ?? ''}`;
    const file = `cand-${state}.svg`;
    await writeFile(join(ROOT, 'src/animations', file), `<?xml-stylesheet type="text/css" href="maclawd-actions.css"?>
<svg xmlns="http://www.w3.org/2000/svg" class="state-${state}" viewBox="${VIEWBOX}" width="500" height="500" shape-rendering="crispEdges">
  <title>Maclawd ${cand.title}</title><desc>${cand.desc ?? ''}</desc>
  ${body}
</svg>
`);

    const lines = [`.state-${state} { --duration: ${cand.duration / 1000}s; }`];
    for (const layer of cand.layers) {
      const period = layer.period && layer.period !== cand.duration
        ? ` animation-duration: ${layer.period / 1000}s;` : '';
      const origin = layer.origin ? ` transform-origin: ${layer.origin};` : '';
      lines.push(`.state-${state} ${layer.sel} {${origin} animation-name: ${layer.name};${period} }`);
    }
    for (const layer of cand.layers) {
      lines.push(`@keyframes ${layer.name} { ${distribute(layer.poses)} }`);
    }
    blocks.push(lines.join('\n'));

    catalog.push({
      action: cand.action,
      id: state,
      title: cand.title,
      axis: cand.axis,
      desc: cand.desc ?? '',
      source: `src/animations/${file}`,
      durationMs: cand.duration,
    });
  }

  const css = await readFile(CSS, 'utf8');
  const block = [BEGIN, '', ...blocks, '', END].join('\n');
  const begin = css.indexOf(BEGIN);
  const next = begin >= 0
    ? css.slice(0, begin) + block + css.slice(css.indexOf(END, begin) + END.length)
    : `${css.trimEnd()}\n\n${block}\n`;
  await writeFile(CSS, next);

  await writeFile(join(ROOT, 'web/candidate-data.js'),
    '/* 由 scripts/build-candidates.mjs 生成，请勿直接编辑。 */\n'
    + `window.MaclawdCandidates = ${JSON.stringify(catalog, null, 2)};\n`);

  const byAction = {};
  for (const x of catalog) (byAction[x.action] ??= []).push(x);
  console.log(`生成 ${catalog.length} 个手工候选，覆盖 ${Object.keys(byAction).length} 个动作`);
  for (const [action, list] of Object.entries(byAction)) {
    console.log(`  ${action.padEnd(14)} ${list.length} 个`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
