import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createOrchestrator } from '../src/runtime/orchestrator.js';
import { loadActions, loadConvergence } from '../src/runtime/server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const contract = JSON.parse(read('design/main-state-actions.json')).characterContract;
const miniDoc = JSON.parse(read('design/mini-actions.json'));
const actions = loadActions();
const convergence = loadConvergence();
const orchestrator = createOrchestrator({ actions, convergence });

/**
 * 主形态动作 = 除 mini 组以外的一切。
 * 别名条目（只有 id + mapsTo，没有 name）也算——它们是真会上屏的状态，
 * 曾经就因为被过滤掉而永远读不到。
 */
const mainActions = actions.filter((a) => a.group !== 'mini');
const miniIds = new Set(miniDoc.states.map((s) => s.id));

/**
 * mini 是主状态的**投影**，不是第二套状态机。
 * 这组测试守的就是这句话——一旦有人给 mini 加了独立触发、
 * 或者收敛表漏了新动作，都会在这里挂掉。
 */

test('收敛表覆盖全部主形态动作，一个不漏', () => {
  const missing = mainActions
    .map((a) => a.id)
    .filter((id) => !Object.prototype.hasOwnProperty.call(convergence, id));
  assert.deepEqual(missing, [], `这些动作没有 mini 映射：${missing.join(', ')}`);
});

test('收敛表不含已不存在的动作', () => {
  const known = new Set(mainActions.map((a) => a.id));
  const stale = Object.keys(convergence)
    .filter((k) => !k.startsWith('_'))
    .filter((id) => !known.has(id));
  assert.deepEqual(stale, [], `收敛表里有主形态已删除的动作：${stale.join(', ')}`);
});

test('收敛目标全部是真实存在的 mini 动作', () => {
  for (const [from, to] of Object.entries(convergence)) {
    if (from.startsWith('_')) continue;
    assert.ok(miniIds.has(to), `${from} 收敛到了不存在的 ${to}`);
  }
});

test('每个主形态动作在 mini 下都能选出带素材的动作', () => {
  for (const action of mainActions) {
    const plan = orchestrator.plan(action.id, { mini: true });
    assert.ok(plan, `${action.id} 在 mini 下没有计划`);
    assert.ok(plan.actionId.startsWith('mini.'), `${action.id} 收敛后不是 mini 动作：${plan.actionId}`);
    assert.ok(plan.source?.endsWith('.svg'), `${plan.actionId} 缺素材`);
    // 表里穷举过，就不该有一个走到 unmapped 兜底
    assert.equal(plan.unmapped, false, `${action.id} 落到了未映射兜底`);
  }
});

test('未知动作沿回落链找到有映射的祖先，不掉档', () => {
  // 将来新增一个工作修饰时，它应该自动跟着 working 走，而不是掉回 idle
  const plan = orchestrator.plan('working.something-new', { mini: true });
  assert.equal(plan.actionId, 'mini.busy');
  assert.equal(plan.convergedFrom, 'working.something-new');
  assert.equal(plan.unmapped, false);
});

test('真的无处可归时标 unmapped，而不是静默兜底', () => {
  // 静默兜底等于把缺口藏起来——探针和面板要能看见它
  const plan = orchestrator.plan('totally-unknown', { mini: true });
  assert.equal(plan.actionId, 'mini.idle');
  assert.equal(plan.unmapped, true);
});

test('不开 mini 时收敛不生效', () => {
  const plan = orchestrator.plan('working.testing');
  assert.equal(plan.actionId, 'working.testing');
  assert.equal(plan.convergedFrom, null);
  assert.equal(plan.unmapped, false);
});

test('语义相近的动作收敛到同一档，相远的不会', () => {
  const mini = (id) => orchestrator.plan(id, { mini: true }).actionId;
  // 保留下来的两个工作修饰，区别全在道具上；mini 没有道具，合并是对的
  for (const id of ['working', 'working.building', 'working.testing']) {
    assert.equal(mini(id), 'mini.busy', id);
  }
  // 「要你决定」和「出错了」刻意不合并：前者需要立刻响应，后者不一定
  assert.equal(mini('needs_owner'), 'mini.alert');
  assert.equal(mini('error'), 'mini.error');
  assert.notEqual(mini('needs_owner'), mini('error'));
});

test('转场是 oneshot，不允许瞬切', () => {
  for (const id of ['mini.enter', 'mini.exit']) {
    const plan = orchestrator.plan(id);
    assert.equal(plan.mode, 'oneshot', `${id} 必须是 oneshot`);
    assert.ok(plan.durationMs > 0, `${id} 必须有时长`);
  }
});

test('mini 素材的角色几何与契约完全一致', () => {
  // 生成而非手写的意义就在这里：几何永远不可能和主形态漂移
  for (const state of miniDoc.states) {
    const svg = read(state.source);
    assert.match(svg, new RegExp(`x="${contract.torso.x}" y="${contract.torso.y}" `
      + `width="${contract.torso.width}" height="${contract.torso.height}"`),
    `${state.source} 躯干与契约不一致`);
    assert.ok(svg.includes(`fill="${contract.bodyColor}"`), `${state.source} 体色不一致`);
    assert.ok(svg.includes(`fill="${contract.eyeColor}"`), `${state.source} 眼色不一致`);
    for (const x of contract.eyesX) {
      assert.ok(svg.includes(`x="${x}" y="${contract.eyesY}"`), `${state.source} 眼位不一致`);
    }
  }
});

test('mini 素材统一使用 mini 取景，且不带任何道具', () => {
  for (const state of miniDoc.states) {
    const svg = read(state.source);
    assert.ok(svg.includes(`viewBox="${miniDoc.miniContract.viewBox}"`),
      `${state.source} 取景不是 mini 的`);
    assert.ok(svg.includes('class="tuck"'), `${state.source} 缺贴边分组`);
    // 道具在主形态里都是 actor 之外的兄弟分组；mini 一个都不该有
    const groups = svg.match(/<g class="([a-z-]+)"/g) ?? [];
    const propish = groups.filter((g) => !/tuck|actor|left-claw|right-claw|eyes/.test(g));
    assert.deepEqual(propish, [], `${state.source} 带了道具：${propish.join(', ')}`);
  }
});

test('每个 mini 动作都有对应的 CSS 状态类', () => {
  const css = read('src/animations/maclawd-actions.css');
  for (const state of miniDoc.states) {
    const cls = state.id.replace('.', '-');
    assert.ok(css.includes(`.state-${cls} {`), `CSS 缺 .state-${cls}`);
    assert.ok(css.includes(`.state-${cls} .actor`), `.state-${cls} 没有驱动 actor`);
  }
});

test('mini 的取景比例让角色在屏幕上不缩水', () => {
  const c = miniDoc.miniContract;
  const [, , w, h] = c.viewBox.split(' ').map(Number);
  assert.equal(w, h, 'mini 取景必须是方形，否则 48×48 窗口会拉伸角色');
  assert.equal(c.windowSize / w, c.unitsPerPixel, '声明的 px/单位与取景对不上');
  // 主形态 128/45 ≈ 2.84；mini 必须不低于它，否则「推近镜头」这个前提就不成立
  assert.ok(c.unitsPerPixel >= 128 / 45, 'mini 比主形态还小，那就成了单纯缩小');
});

test('贴边位真的会裁掉右半边角色', () => {
  const c = miniDoc.miniContract;
  const [x0, , w] = c.viewBox.split(' ').map(Number);
  const rightEdge = x0 + w;
  // 右眼被裁掉、左眼保留，才有「静止时只露一只眼睛」这个表意
  const [leftEye, rightEye] = contract.eyesX.map((x) => x + c.tuckOffsetX);
  assert.ok(leftEye < rightEdge, '贴边位左眼也被裁掉了，看不到脸');
  assert.ok(rightEye >= rightEdge, '贴边位右眼没被裁掉，探出就没有区别了');
});

test('探出动作真的把第二只眼睛带进画面', () => {
  // 这是 mini 全部表意的支点：贴着只有一只眼，探出才有两只。
  // 如果哪天有人把探出幅度调小，动作就白做了——这里守住它。
  const css = read('src/animations/maclawd-actions.css');
  const block = css.match(/@keyframes mini-peek-body \{([^}]*\}[^}]*)\}\s*$/m)
    ?? css.match(/@keyframes mini-peek-body \{([\s\S]*?)\n@/);
  assert.ok(block, '找不到 mini-peek-body 的关键帧');
  const xs = [...block[1].matchAll(/translate\((-?\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(xs.length > 0, '探出动作没有水平位移');

  const c = miniDoc.miniContract;
  const [x0, , w] = c.viewBox.split(' ').map(Number);
  const rightEdge = x0 + w;
  const rightEyeTucked = contract.eyesX[1] + c.tuckOffsetX;
  const peak = Math.min(...xs);
  assert.ok(rightEyeTucked + peak < rightEdge - 1,
    `探出 ${peak}px 不足以让右眼进入画面（需要 < ${rightEdge - 1 - rightEyeTucked}）`);
});

test('mini 的爪子不许向左脱离躯干，身体不许长期倾斜', () => {
  const css = read('src/animations/maclawd-actions.css');
  // 每条 @keyframes 都写在一行里，所以按行匹配即可。
  const blocks = [...css.matchAll(/^@keyframes (mini-[a-z]+-(claw|body)) \{(.*)\}$/gm)];
  assert.ok(blocks.length >= 12, `没抓到足够的 mini 关键帧：${blocks.length}`);

  for (const [, name, kind, body] of blocks) {
    if (kind === 'claw') {
      // 爪根紧贴躯干左沿，向左位移会拉开一条缝。带道具的主形态里那读作
      // 「伸手去够」，mini 没有道具可够，离体的爪子只会读作渲染错误。
      const lefts = [...body.matchAll(/translate\((-\d+)px/g)];
      assert.deepEqual(lefts.map((m) => m[1]), [], `${name} 有向左位移，爪子会脱离躯干`);
    } else {
      // 整套动作是轴对齐的像素矩形。躯干长期倾斜在 crispEdges 下会渲染成
      // 锯齿平行四边形，看起来像素材画坏了——「垮掉」用下沉+纵向压缩表达。
      assert.ok(!body.includes('rotate'), `${name} 让躯干倾斜了`);
    }
  }
});

test('mini 的动作不会把角色顶出取景', () => {
  // 取景只有 16 单位高，躯干顶到上边界的余量很小。
  // 跳得过高会把头裁掉——这在几何静态检查里看不出来，只有跑起来才显形。
  const css = read('src/animations/maclawd-actions.css');
  const c = miniDoc.miniContract;
  const [, y0, , h] = c.viewBox.split(' ').map(Number);
  const headroom = contract.torso.y - y0;
  const legBottom = contract.legsY + contract.legHeight;
  const footroom = y0 + h - legBottom;

  for (const [, name, body] of css.matchAll(/^@keyframes (mini-[a-z]+-body) \{(.*)\}$/gm)) {
    const ys = [...body.matchAll(/translate\(-?\d+px,\s*(-?\d+)px\)|translateY\((-?\d+)px\)/g)]
      .map((m) => Number(m[1] ?? m[2]));
    if (!ys.length) continue;
    assert.ok(-Math.min(...ys) <= headroom,
      `${name} 上移 ${-Math.min(...ys)} 超过 ${headroom} 单位余量，头会被裁掉`);
    assert.ok(Math.max(...ys) <= footroom,
      `${name} 下移 ${Math.max(...ys)} 超过 ${footroom} 单位余量，脚会被裁掉`);
  }
});
