import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ANIMATIONS } from '../design/motion-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const css = read('src/animations/maclawd-actions.css');

/**
 * 运动质量的不变量。
 *
 * 现有测试守的是「素材存在、几何一致」——那些守不住**动作好不好看**。
 * 这一组把三条量化诊断变成机器能守的规则，因为它们全都会被
 * 「顺手改一下」悄悄破坏，而破坏之后没有任何东西会报错。
 *
 * 数据来自 design/motion-refinement.md 的全量测量。
 */

/** 用括号配对取出每条 @keyframes 的完整体，兼容单行与多行写法。 */
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

const keyframes = parseKeyframes(css);

/** 每个姿态块的起始百分比。 */
function stops(body) {
  const set = new Set();
  for (const blk of body.matchAll(/([\d%,\s]+)\{/g)) {
    const pcts = [...blk[1].matchAll(/(\d+)%/g)].map((x) => Number(x[1]));
    if (pcts.length) set.add(Math.min(...pcts));
  }
  return [...set].sort((a, b) => a - b);
}

function variation(body) {
  const s = stops(body);
  if (s.length < 3) return null;
  const holds = s.map((v, i) => (i === s.length - 1 ? 100 : s[i + 1]) - v);
  const mean = holds.reduce((a, b) => a + b, 0) / holds.length;
  const sd = Math.sqrt(holds.reduce((a, b) => a + (b - mean) ** 2, 0) / holds.length);
  return sd / mean;
}

test('缓动：保持时长不许等分', () => {
  // 定格动画的缓动靠不均匀的保持时长表达（极端姿势多停、中间姿势快过）。
  // 手排百分比时人会不自觉地等分——重做前 36 条里 31 条低于 0.35，
  // moving-body 干脆是 [20,20,20,20,20]。等分 = 匀速 = 机械。
  const offenders = [];
  for (const [name, body] of Object.entries(keyframes)) {
    if (!name.endsWith('-body') || name.startsWith('mini-')) continue;
    const cv = variation(body);
    if (cv !== null && cv < 0.35) offenders.push(`${name}=${cv.toFixed(2)}`);
  }
  assert.deepEqual(offenders, [], `这些身体动画的节奏接近匀速：${offenders.join(', ')}`);
});

test('密度：姿态谱里的动作都达到最低变化频率', () => {
  // 屏幕上「多久变一次」= 所有图层变化时刻的并集。
  // 重做前中位 1.56 姿态/秒，像素画待机循环的通常下限是 4。
  // 这里的门槛取 2.8——刻意低于 4，因为有些动作**应该**慢：
  // sleeping 每秒变 4 次会显得焦躁，low-battery 的读感就来自「快没气了」。
  // 门槛守的是「不许退回静止图」，不是强推所有动作一样快。
  const FLOOR = 2.8;
  const slow = [];
  for (const anim of ANIMATIONS) {
    const union = new Set();
    for (const layer of anim.layers) {
      const period = layer.period ?? anim.duration;
      const total = layer.poses.reduce((n, [, w]) => n + w, 0);
      let acc = 0;
      const offsets = layer.poses.map(([, w]) => {
        const at = (acc / total) * period;
        acc += w;
        return at;
      });
      // 周期短于状态时长的图层在一个状态周期内会转好几轮
      for (let cycle = 0; cycle * period < anim.duration; cycle++) {
        for (const off of offsets) {
          const t = cycle * period + off;
          if (t < anim.duration) union.add(Math.round(t));
        }
      }
    }
    const rate = union.size / (anim.duration / 1000);
    if (rate < FLOOR) slow.push(`${anim.state}=${rate.toFixed(2)}`);
  }
  // sleeping 与 low-battery 是刻意的慢，登记在案
  const allowed = new Set(['sleeping', 'low-battery', 'recovering']);
  const unexpected = slow.filter((s) => !allowed.has(s.split('=')[0]));
  assert.deepEqual(unexpected, [], `这些动作慢到接近静止图：${unexpected.join(', ')}`);
});

test('像素栅格：渲染尺寸必须是取景单位数的整数倍', () => {
  // 非整数比时，1 单位宽的矩形会因落点不同被渲成 2px 或 3px，
  // 角色每移动一格轮廓就抖一次。旧值 128÷45=2.844 就是这个问题。
  const main = JSON.parse(read('design/main-state-actions.json'));
  const [, , mainUnits] = main.characterContract.viewBox.split(' ').map(Number);
  for (const size of main.designRules.qaSizes) {
    assert.equal(size % mainUnits, 0, `主形态 QA 尺寸 ${size} 不是 ${mainUnits} 的整数倍`);
  }

  const mini = JSON.parse(read('design/mini-actions.json'));
  const [, , miniUnits] = mini.miniContract.viewBox.split(' ').map(Number);
  assert.equal(mini.miniContract.windowSize % miniUnits, 0, 'mini 窗口尺寸不是整数倍');
  for (const size of mini.designRules.qaSizes) {
    assert.equal(size % miniUnits, 0, `mini QA 尺寸 ${size} 不是 ${miniUnits} 的整数倍`);
  }

  // 外壳里写死的主形态窗口尺寸也要守这条
  const swift = read('mac/Sources/Maclawd/PetWindow.swift');
  const declared = Number(swift.match(/size: CGFloat = (\d+)/)?.[1]);
  assert.ok(declared, '读不到外壳的主形态窗口尺寸');
  assert.equal(declared % mainUnits, 0,
    `外壳窗口 ${declared}px 不是 ${mainUnits} 单位的整数倍（${(declared / mainUnits).toFixed(3)} px/单位）`);
});

test('timing-function 必须是 step-end，不许改成插值', () => {
  // 插值会产生非整数单位位置，矩形边缘落在设备像素中间 → 糊边或反复跳变。
  // 像素画的流畅来自姿态密度与节奏，不来自插值。这条容易被「顺手优化」掉。
  assert.match(css, /\.motion\s*\{[^}]*animation-timing-function:\s*step-end/,
    '.motion 的 timing-function 不再是 step-end');
});

test('姿态谱与样式表同步——生成器跑过', () => {
  // 改了 motion-poses.mjs 却忘了跑生成器，样式表会停在旧版本上，
  // 而这种不同步不会有任何东西报错。
  for (const anim of ANIMATIONS) {
    assert.ok(css.includes(`.state-${anim.state} { --duration: ${anim.duration / 1000}s; }`),
      `${anim.state} 的时长与姿态谱不一致，需要重跑 build-motion-css.mjs`);
    for (const layer of anim.layers) {
      assert.ok(keyframes[layer.name], `${anim.state} 的 ${layer.name} 没生成`);
      assert.equal(stops(keyframes[layer.name]).length, layer.poses.length,
        `${layer.name} 的姿态数与姿态谱不一致`);
    }
  }
});

test('每个动作的时长都没被改动', () => {
  // 时长是契约锁定的：状态机的最小驻留与 oneshot 插播时序都依赖它。
  // 重做运动时只补姿态、不改时长。
  const contracts = ['design/main-state-actions.json', 'design/activity-modifiers.json',
    'design/interaction-actions.json', 'design/runtime-lifecycle-actions.json'];
  const byState = new Map(ANIMATIONS.map((a) => [a.state, a.duration]));
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.source && node.durationMs) {
      const cls = read(node.source).match(/class="state-([a-z0-9_-]+)"/)?.[1];
      if (cls && byState.has(cls)) {
        assert.equal(byState.get(cls), node.durationMs,
          `${node.id} 的时长在姿态谱里被改成了 ${byState.get(cls)}，契约是 ${node.durationMs}`);
      }
    }
    Object.values(node).forEach(walk);
  };
  for (const file of contracts) walk(JSON.parse(read(file)));
});

test('样式表不驱动素材里不存在的图层', () => {
  // 重做动作时最容易留下的垃圾：改了素材的分组结构，
  // 却忘了同步样式表。多余的规则不会报错，只会静默不生效——
  // 于是「这个动作怎么不动」要查很久。
  const dir = join(ROOT, 'src/animations');
  const layers = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
    const svg = readFileSync(join(dir, file), 'utf8');
    const state = svg.match(/class="(?:[a-z]+ )?state-([a-z0-9_-]+)"/)?.[1];
    if (!state) continue;
    layers.set(state, new Set([...svg.matchAll(/class="([a-z0-9-]+)(?: motion)?"/g)].map((m) => m[1])));
  }
  assert.ok(layers.size >= 30, `只识别到 ${layers.size} 个素材，正则可能失配`);

  const dead = [];
  for (const m of css.matchAll(/^\.state-([a-z0-9_-]+) \.([a-z0-9-]+)\s*\{/gm)) {
    const [, state, layer] = m;
    if (layers.has(state) && !layers.get(state).has(layer)) dead.push(`${state} → .${layer}`);
  }
  assert.deepEqual(dead, [], `这些规则驱动的图层在素材里不存在：${dead.join(', ')}`);
});

test('持续态的循环里不许有静止姿态，接缝不许停顿', () => {
  // working 旧版首尾两个姿态都是 translate(0,0)，加起来 43% 的循环停在原位，
  // 而且首尾同为原位——跨过循环接缝后是连续 1.5 秒的静止，
  // 于是「持续在工作」读成了「干一下、停一下」。
  //
  // 只对**表示持续活动**的状态设这条。idle / sleeping / paused 恰恰
  // 应该有静止，对它们套这条规则是反的。
  const SUSTAINED = ['working', 'thinking', 'delegating', 'compacting',
    'building', 'testing', 'drag', 'hover',
    // working 的候选方案也守同一条，否则选进来才发现有停顿就晚了
    'work-b', 'work-c', 'work-d', 'work-e', 'work-f', 'work-g', 'work-h',
    'work-i', 'work-j', 'work-l', 'work-n'];
  const IDENTITY = /^translate\(0,\s*0\)$|^translateY\(0\)$|^translateX\(0\)$/;

  for (const state of SUSTAINED) {
    const anim = ANIMATIONS.find((a) => a.state === state);
    assert.ok(anim, `姿态谱里没有 ${state}`);
    const body = anim.layers.find((l) => l.sel === '.actor');
    assert.ok(body, `${state} 没有身体图层`);

    const first = body.poses[0][0].trim();
    const last = body.poses.at(-1)[0].trim();
    assert.notEqual(first, last,
      `${state} 的首尾姿态相同（${first}），跨接缝会连成一段停顿`);

    const resting = body.poses
      .filter(([t]) => IDENTITY.test(t.trim()))
      .reduce((n, [, w]) => n + w, 0);
    const total = body.poses.reduce((n, [, w]) => n + w, 0);
    const share = resting / total;
    assert.ok(share < 0.15,
      `${state} 有 ${(share * 100).toFixed(0)}% 的循环停在原位，读不出持续活动`);
  }
});
