#!/usr/bin/env node
/**
 * 把手写的 @keyframes 反解成姿态谱（design/motion-poses.mjs 的格式）。
 *
 * 为什么要反解：变体生成器按「姿态 + 权重」做参数化（幅度、节奏、缓动），
 * 只有进了姿态谱的动作才能被程序化地变。8 个 mini 动作当初是手写 CSS 的，
 * 不反解就只能手工给它们各写 5 个变体——那既慢又必然与主形态的轴不一致。
 *
 * 反解是**有损**的：手写的百分比里，权重信息只存在于「保持时长」中。
 * 这里把保持时长按最大公约数约成小整数，还原出的权重比例与原来一致，
 * 但不保证数值相同。所以输出要人工过一眼再并入姿态谱，不直接写文件。
 *
 * 用法：node scripts/port-css-to-poses.mjs mini-idle mini-busy ...
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 用括号配对取出每条 @keyframes 的完整体，兼容单行与多行。 */
function parseKeyframes(text) {
  const out = {};
  const re = /@keyframes\s+([a-z0-9-]+)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    out[m[1]] = text.slice(start, i - 1);
  }
  return out;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** 一条 keyframes → [[declaration, weight], ...] */
function toPoses(body) {
  const blocks = [];
  // 形如 `0%,44%{transform:translateY(0)}`——取每段的起始百分比与声明
  for (const m of body.matchAll(/([\d%,\s]+)\{([^}]*)\}/g)) {
    const pcts = [...m[1].matchAll(/(\d+)%/g)].map((x) => Number(x[1]));
    if (!pcts.length) continue;
    blocks.push({ start: Math.min(...pcts), decl: m[2].trim() });
  }
  blocks.sort((a, b) => a.start - b.start);
  if (!blocks.length) return [];

  const holds = blocks.map((b, i) => (
    (i === blocks.length - 1 ? 100 : blocks[i + 1].start) - b.start
  ));
  // 约成小整数：权重是**比例**，绝对值没有意义
  const g = holds.reduce((a, b) => gcd(a, b), holds[0]) || 1;
  return blocks.map((b, i) => {
    // 姿态谱里只有 transform 值时省略前缀，其余原样保留（opacity 等）
    const decl = /^transform:\s*/.test(b.decl) && !b.decl.includes(';')
      ? b.decl.replace(/^transform:\s*/, '')
      : b.decl;
    return [decl, Math.max(1, Math.round(holds[i] / g))];
  });
}

async function main() {
  const wanted = process.argv.slice(2);
  if (!wanted.length) {
    console.error('用法: node scripts/port-css-to-poses.mjs <state-class>...');
    process.exit(1);
  }
  const css = await readFile(join(ROOT, 'src/animations/maclawd-actions.css'), 'utf8');
  const keyframes = parseKeyframes(css);

  for (const state of wanted) {
    // 该状态驱动了哪些图层
    const layers = [];
    const re = new RegExp(
      `\\.state-${state}\\s+(\\.[a-z0-9-]+)\\s*\\{([^}]*?)animation-name:\\s*([a-z0-9-]+)([^}]*)\\}`,
      'g',
    );
    for (const m of css.matchAll(re)) {
      const period = m[4].match(/animation-duration:\s*([\d.]+)s/)
        ?? m[2].match(/animation-duration:\s*([\d.]+)s/);
      const origin = m[2].match(/transform-origin:\s*([^;]+);/);
      layers.push({ sel: m[1], name: m[3], period: period ? Number(period[1]) * 1000 : null, origin: origin?.[1]?.trim() ?? null });
    }
    const dur = css.match(new RegExp(`\\.state-${state}\\s*\\{\\s*--duration:\\s*([\\d.]+)s`));
    if (!layers.length) {
      console.error(`  ⚠︎ ${state}: 没找到任何图层规则`);
      continue;
    }

    console.log(`  {`);
    console.log(`    state: '${state}',`);
    console.log(`    duration: ${dur ? Number(dur[1]) * 1000 : 3000},`);
    console.log(`    comment: '（由 port-css-to-poses.mjs 从手写 CSS 反解，权重是比例还原）',`);
    console.log(`    layers: [`);
    for (const l of layers) {
      const poses = toPoses(keyframes[l.name] ?? '');
      if (!poses.length) { console.error(`  ⚠︎ ${l.name}: 关键帧为空`); continue; }
      const extra = [
        l.period ? `period: ${l.period}` : null,
        l.origin ? `origin: '${l.origin}'` : null,
      ].filter(Boolean).join(', ');
      console.log(`      { sel: '${l.sel}', name: '${l.name}'${extra ? ', ' + extra : ''}, poses: [`);
      const body = poses.map(([d, w]) => `p(${JSON.stringify(d)}, ${w})`).join(', ');
      console.log(`        ${body} ] },`);
    }
    console.log(`    ],`);
    console.log(`  },`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
