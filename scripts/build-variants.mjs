#!/usr/bin/env node
/**
 * 为每个动作生成 5 个候选变体。
 *
 * **这些是系统化变体，不是逐个手工设计的动画。** 每个候选沿一条明确的轴
 * 参数化——幅度、节奏、缓动——所以每一个都能回答一个具体的问题
 * （「要不要更夸张」「要不要更快」），而不是「换个样子看看」。
 *
 * 之所以不逐个手设计：这一轮里手写的第一批 working 候选被判为「太类似」，
 * 复盘下来是对的——四个只换了道具，姿态语汇没变。无差别地给 64 个动作
 * 各手编 5 个，几乎必然重演那个结果，只是规模大 80 倍。
 * 与其造 320 个换皮，不如给 320 个**有名字的变化**。
 *
 * 变体不产生新素材：同一个 SVG，靠祖先元素上的 `data-variant` 切换
 * 不同的 keyframes。所以 320 个候选只是 CSS，没有 320 个文件。
 *
 * 用法：node scripts/build-variants.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ANIMATIONS } from '../design/motion-poses.mjs';
import { loadActions } from '../src/runtime/server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'src/animations/maclawd-actions.css');
const BEGIN = '/* === 变体：由 scripts/build-variants.mjs 生成，请勿手改 === */';
const END = '/* === 变体区结束 === */';

export const AXES = [
  { id: 'base', label: '基准', note: '当前实现，作对照' },
  { id: 'bold', label: '幅度加倍', note: '所有位移 ×2（取整），节奏不变' },
  { id: 'brisk', label: '节奏加快', note: '时长 ×0.7，幅度不变' },
  { id: 'languid', label: '舒缓', note: '时长 ×1.4，幅度减半' },
  { id: 'staccato', label: '顿挫', note: '极端姿势停更久、过渡更快——缓动更重' },
];

/**
 * 缩放一个 transform 声明里的所有 px 位移。
 *
 * 只动 px：`scaleY(1.08)` 之类的比例值不能乘——把 1.08 翻倍会变成 2.16，
 * 那不是「幅度加倍」是「身体变两倍高」。旋转同理，角度翻倍常常直接翻车。
 * 结果**取整**：主形态 3px/单位，非整数位移会让矩形边缘落在设备像素中间。
 */
function scalePx(decl, factor) {
  return decl.replace(/(-?\d+(?:\.\d+)?)px/g, (_, n) => {
    const scaled = Math.round(Number(n) * factor);
    return `${scaled}px`;
  });
}

/** 把权重推向两极：大的更大、小的更小。这就是「顿挫」。 */
function polarize(poses) {
  const weights = poses.map(([, w]) => w);
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  return poses.map(([decl, w]) => {
    // 高于均值的拉长、低于均值的压短，最少保留 1
    const next = w >= mean ? Math.round(w * 1.6) : Math.max(1, Math.round(w * 0.5));
    return [decl, next];
  });
}

function transform(anim, axis) {
  if (axis === 'base') return null;
  const out = { duration: anim.duration, layers: [] };
  for (const layer of anim.layers) {
    let poses = layer.poses;
    let period = layer.period ?? null;
    if (axis === 'bold') poses = poses.map(([d, w]) => [scalePx(d, 2), w]);
    if (axis === 'languid') poses = poses.map(([d, w]) => [scalePx(d, 0.5), w]);
    if (axis === 'staccato') poses = polarize(poses);
    if (axis === 'brisk' || axis === 'languid') {
      const k = axis === 'brisk' ? 0.7 : 1.4;
      out.duration = Math.round(anim.duration * k);
      if (period) period = Math.round(period * k);
    }
    out.layers.push({ ...layer, poses, period });
  }
  return out;
}

/** 权重 → 百分比区间。与 build-motion-css.mjs 同一套算法，必须保持一致。 */
function distribute(poses) {
  const total = poses.reduce((n, [, w]) => n + w, 0);
  const out = [];
  let acc = 0;
  for (let i = 0; i < poses.length; i++) {
    const [decl, weight] = poses[i];
    const start = Math.round((acc / total) * 100);
    acc += weight;
    const end = i === poses.length - 1 ? 100 : Math.max(start, Math.round((acc / total) * 100) - 1);
    const body = decl.includes(':') ? decl : `transform:${decl}`;
    out.push(`${start}%,${end}%{${body}}`);
  }
  return out.join(' ');
}

function emit(anim, axis) {
  const t = transform(anim, axis);
  if (!t) return '';
  const sel = `.state-${anim.state}[data-variant="${axis}"]`;
  const lines = [`${sel} { --duration: ${t.duration / 1000}s; }`];
  for (const layer of t.layers) {
    const name = `${layer.name}--${axis}`;
    const period = layer.period && layer.period !== t.duration
      ? ` animation-duration: ${layer.period / 1000}s;`
      : '';
    const origin = layer.origin ? ` transform-origin: ${layer.origin};` : '';
    lines.push(`${sel} ${layer.sel} {${origin} animation-name: ${name};${period} }`);
  }
  for (const layer of t.layers) {
    lines.push(`@keyframes ${layer.name}--${axis} { ${distribute(layer.poses)} }`);
  }
  return lines.join('\n');
}

async function main() {
  const actions = loadActions();
  // 状态 class → 契约动作。变体只对**契约里有的**动作有意义——
  // 候选素材（work-b…work-s）本身就是候选，再给它们做变体是套娃。
  const byState = new Map();
  for (const a of actions) {
    if (!a.source) continue;
    const svg = await readFile(join(ROOT, a.source), 'utf8');
    const cls = svg.match(/class="(?:[a-z]+ )?state-([a-z0-9_-]+)"/)?.[1];
    if (cls && !byState.has(cls)) byState.set(cls, a);
  }

  const blocks = [];
  const catalog = [];
  for (const anim of ANIMATIONS) {
    const action = byState.get(anim.state);
    if (!action) continue;
    for (const axis of AXES) {
      const css = emit(anim, axis.id);
      if (css) blocks.push(css);
    }
    catalog.push({
      id: action.id,
      name: action.name,
      group: action.group,
      state: anim.state,
      source: action.source,
      durationMs: anim.duration,
      isMini: action.group === 'mini',
    });
  }

  const css = await readFile(CSS, 'utf8');
  const block = [BEGIN, '', ...blocks, '', END].join('\n');
  const begin = css.indexOf(BEGIN);
  const next = begin >= 0
    ? css.slice(0, begin) + block + css.slice(css.indexOf(END, begin) + END.length)
    : `${css.trimEnd()}\n\n${block}\n`;
  await writeFile(CSS, next);

  await writeFile(join(ROOT, 'web/variant-data.js'),
    '/* 由 scripts/build-variants.mjs 生成，请勿直接编辑。 */\n'
    + `window.MaclawdVariants = ${JSON.stringify({ axes: AXES, actions: catalog }, null, 2)};\n`);

  console.log(`生成 ${catalog.length} 个动作 × ${AXES.length} 轴 = ${catalog.length * AXES.length} 个候选`);
  const skipped = ANIMATIONS.length - catalog.length;
  if (skipped) console.log(`  跳过 ${skipped} 个（候选素材与占位，不做套娃变体）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
