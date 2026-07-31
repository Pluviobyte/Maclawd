#!/usr/bin/env node
/**
 * 由 design/motion-poses.mjs 的姿态谱生成 CSS，写入共享样式表的标记区。
 *
 * 生成而不是手写的理由见 motion-poses.mjs 顶部。这里只负责两件机械活：
 *
 * 1. **按权重算百分比。** 手排百分比时人会不自觉地等分，等分 = 匀速 = 机械。
 *    这里权重越大保持越久，缓动是算出来的，等分不可能发生。
 *
 * 2. **每层各自的周期。** 图层可以声明 period 覆盖状态的默认时长，
 *    于是身体、爪、眼睛各走各的拍子，合成图案的重复周期变成最小公倍数。
 *
 * 标记区之外的手写规则原样保留——这是增量迁移，不是一次性重写。
 *
 * 用法：node scripts/build-motion-css.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ANIMATIONS } from '../design/motion-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'src/animations/maclawd-actions.css');
const BEGIN = '/* === 由 scripts/build-motion-css.mjs 生成，请勿手改以下区域 === */';
const END = '/* === 生成区结束 === */';

/**
 * 权重 → 百分比区间。
 *
 * step-end 下每个姿态占 [start, nextStart)，所以只需要给出每段的起点。
 * 写成 `a%,b%{...}` 的形式（起点与终点同一姿态），与手写块保持一致，
 * 这样已有的审计脚本不用改就能继续数姿态数。
 */
function distribute(poses) {
  const total = poses.reduce((n, [, w]) => n + w, 0);
  const out = [];
  let acc = 0;
  for (let i = 0; i < poses.length; i++) {
    const [transform, weight] = poses[i];
    const start = Math.round((acc / total) * 100);
    acc += weight;
    // 最后一段收在 100%，中间段收在下一段起点前一格
    const end = i === poses.length - 1 ? 100 : Math.max(start, Math.round((acc / total) * 100) - 1);
    // 多数姿态只是一个 transform 值，但像 Zzz、助手那样需要 opacity 的，
    // 写的是完整声明（`opacity:0;transform:...`）。无脑包一层 transform:
    // 会产出 `transform:opacity:0;transform:...` 这种无效 CSS——
    // 浏览器静默丢弃整条规则，动画看起来就是「没做」。
    const decl = transform.includes(':') ? transform : `transform:${transform}`;
    out.push(`${start}%,${end}%{${decl}}`);
  }
  return out.join(' ');
}

function emit(anim) {
  const lines = [];
  if (anim.comment) lines.push(`/* ${anim.state}：${anim.comment} */`);
  lines.push(`.state-${anim.state} { --duration: ${anim.duration / 1000}s; }`);
  for (const layer of anim.layers) {
    const period = layer.period && layer.period !== anim.duration
      ? ` animation-duration: ${layer.period / 1000}s;`
      : '';
    // 道具大多绕着自己的支点转（罐子的底、行李箱的合页、助手的落脚点），
    // 少了 transform-origin 会绕着角色的脚转，整个构图就散了。
    const origin = layer.origin ? ` transform-origin: ${layer.origin};` : '';
    lines.push(`.state-${anim.state} ${layer.sel} {${origin} animation-name: ${layer.name};${period} }`);
  }
  for (const layer of anim.layers) {
    lines.push(`@keyframes ${layer.name} { ${distribute(layer.poses)} }`);
  }
  return lines.join('\n');
}

async function main() {
  const css = await readFile(CSS, 'utf8');
  const block = [BEGIN, '', ...ANIMATIONS.map(emit), '', END].join('\n');

  let next;
  const begin = css.indexOf(BEGIN);
  if (begin >= 0) {
    const end = css.indexOf(END, begin);
    if (end < 0) throw new Error('找到起始标记但没找到结束标记，样式表可能被手工改坏了');
    next = css.slice(0, begin) + block + css.slice(end + END.length);
  } else {
    next = `${css.trimEnd()}\n\n${block}\n`;
  }
  await writeFile(CSS, next);

  const layers = ANIMATIONS.reduce((n, a) => n + a.layers.length, 0);
  const poses = ANIMATIONS.reduce((n, a) => n + a.layers.reduce((m, l) => m + l.poses.length, 0), 0);
  console.log(`生成 ${ANIMATIONS.length} 个动作 / ${layers} 个图层 / ${poses} 个姿态`);
  for (const a of ANIMATIONS) {
    // 屏幕上「多久变一次」= 所有图层变化时刻的并集。
    // 周期短于状态时长的图层会在一个状态周期内**转好几轮**，
    // 每一轮的时刻都要数进来——只数一轮会严重低估错拍带来的密度。
    const union = new Set();
    for (const l of a.layers) {
      const period = l.period ?? a.duration;
      const total = l.poses.reduce((n, [, w]) => n + w, 0);
      const offsets = [];
      let acc = 0;
      for (const [, w] of l.poses) {
        offsets.push((acc / total) * period);
        acc += w;
      }
      for (let cycle = 0; cycle * period < a.duration; cycle++) {
        for (const off of offsets) {
          const t = cycle * period + off;
          if (t < a.duration) union.add(Math.round(t));
        }
      }
    }
    const rate = (union.size / (a.duration / 1000)).toFixed(2);
    console.log(`  ${a.state.padEnd(20)} ${union.size} 个变化时刻 / ${a.duration / 1000}s = ${rate} 姿态/秒`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
