#!/usr/bin/env node
/**
 * 由契约生成动作总表页（web/actions.html）。
 *
 * **生成而不是手写**：这张表要回答「现在到底有哪些动作、各自由什么触发、
 * 谁压得过谁」。手写的表和契约必然漂移，而漂移之后它会变成一份
 * 看起来权威、实际在骗人的文档——比没有更糟。
 *
 * 数据全部来自三个真实来源：
 *   - design/*.json          动作契约（id / 名字 / 时长 / 模式 / 道具 / 素材）
 *   - state-engine.js        触发源与优先级（靠解析源码，不复制一份）
 *   - design/motion-poses.mjs 运动密度（重做过的动作才有）
 *
 * 用法：node scripts/build-action-catalog.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadActions, loadConvergence } from '../src/runtime/server.js';
import { PRIORITY, SHELL_ACTIONS } from '../src/runtime/state-engine.js';
import { ANIMATIONS } from '../design/motion-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * hook 事件 → 状态。从引擎源码里解析出来，避免在这里再抄一份。
 *
 * 注意 switch 块**之外**还有两条产生状态的路径，必须一起收：
 * 静默转场（away / sleeping）与唤醒插播（waking）。漏掉它们，
 * 表上会把这三个动作标成「没有触发源」——那正好是这张表最该避免的
 * 那种错误：看起来权威，实际在骗人。
 */
async function hookTriggers() {
  const src = await readFile(join(ROOT, 'src/runtime/state-engine.js'), 'utf8');
  const out = {};

  // 静默路径：resolve() 里按 reason 'silence' 直接 emit
  for (const m of src.matchAll(/emit\(\{ actionId: '([a-z_.]+)'[^)]*\}, '(silence|idle)'/g)) {
    (out[m[1]] ??= new Set()).add(m[2] === 'silence' ? '静默转场' : 'idle 加权轮换');
  }
  // 唤醒插播：wakeIfAsleep() 在 switch 之外
  if (/function wakeIfAsleep[\s\S]*?pushOneshot\('waking'/.test(src)) {
    (out.waking ??= new Set()).add('从 away / sleeping 被唤醒');
  }

  const body = src.slice(src.indexOf('switch (type)'));
  let event = null;
  for (const line of body.split('\n')) {
    const c = line.match(/case '([A-Za-z]+)':/);
    if (c) { event = c[1]; continue; }
    if (!event) continue;
    const assign = line.match(/s\.state = '([a-z_.]+)'/) || line.match(/pushOneshot\('([a-z_.]+)'/);
    if (assign) (out[assign[1]] ??= new Set()).add(event);
    if (line.includes('classifyBash')) {
      (out['working.testing'] ??= new Set()).add('PreToolUse · Bash 测试命令');
      (out['working.building'] ??= new Set()).add('PreToolUse · Bash 构建命令');
    }
  }
  return out;
}

/** 屏幕上多久变一次姿态。只有重做过运动的动作有这个数。 */
function densityByState() {
  const out = {};
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
      for (let cycle = 0; cycle * period < anim.duration; cycle++) {
        for (const off of offsets) {
          const t = cycle * period + off;
          if (t < anim.duration) union.add(Math.round(t));
        }
      }
    }
    out[anim.state] = +(union.size / (anim.duration / 1000)).toFixed(1);
  }
  return out;
}

const GROUP_TITLES = {
  primary: ['主状态', 'Agent 与 owner 的稳定状态。休眠链、任务链、结果链都有明确转场。'],
  modifier: ['工作修饰', '只保留跑得够久、看得见的两个。Read/Edit 毫秒返回，修饰一闪而过，为它们画动作是白费。'],
  interaction: ['互动与环境', '由桌面交互或系统事件触发，不冒充 Agent 的任务进度。'],
  lifecycle: ['生命周期与生命感', '启动、退出、等待、收尾，以及让桌宠像活物的低频 idle 彩蛋。'],
  mini: ['mini（贴边）', '推出屏幕边缘后收起成 48px。不是把角色缩小，而是把镜头推近、裁掉场景只留演员。'],
};

/** 状态 id → CSS state class，用来查密度。 */
async function stateClassOf(source) {
  if (!source) return null;
  try {
    const svg = await readFile(join(ROOT, source), 'utf8');
    return svg.match(/class="(?:[a-z]+ )?state-([a-z0-9_-]+)"/)?.[1] ?? null;
  } catch { return null; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function main() {
  const actions = loadActions();
  const convergence = loadConvergence();
  const hooks = await hookTriggers();
  const density = densityByState();

  // shell 事件反查：动作 ← 哪个外壳事件
  const shell = {};
  for (const [ev, act] of Object.entries(SHELL_ACTIONS)) (shell[act] ??= []).push(ev);

  const rows = [];
  for (const a of actions) {
    const cls = await stateClassOf(a.source);
    const triggers = [
      ...(hooks[a.id] ? [...hooks[a.id]].map((e) => `hook · ${e}`) : []),
      ...(shell[a.id] ?? []).map((e) => `外壳 · ${e}`),
    ];
    if (a.id.startsWith('idle.')) triggers.push('idle 加权轮换');
    if (a.id === 'idle') triggers.push('idle 加权轮换');
    if (a.id.startsWith('mini.')) triggers.push('mini 档内由收敛表投影');
    rows.push({
      id: a.id,
      name: a.name ?? `（别名 → ${a.mapsTo}）`,
      group: a.group,
      mode: a.mode ?? (a.mapsTo ? 'alias' : ''),
      duration: a.durationMs ? `${a.durationMs / 1000}s` : '—',
      accessory: a.accessory === 'none' ? '无道具' : (a.accessory ?? ''),
      desc: a.action ?? '',
      source: a.source ?? null,
      priority: PRIORITY[a.id] ?? null,
      density: cls && density[cls] ? density[cls] : null,
      mini: convergence[a.id] ?? null,
      triggers,
    });
  }

  const grouped = {};
  for (const r of rows) (grouped[r.group] ??= []).push(r);

  const card = (r) => `
        <article class="act${r.source ? '' : ' alias'}">
          <div class="stage">${r.source
    ? `<object data="${esc(r.source)}" type="image/svg+xml">${esc(r.name)}</object>`
    : '<div class="no-asset">复用其他动作的素材</div>'}</div>
          <div class="body">
            <code class="id">${esc(r.id)}</code>
            <h3>${esc(r.name)}</h3>
            ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
            <dl>
              <div><dt>时长 / 模式</dt><dd>${esc(r.duration)} · ${esc(r.mode || '—')}</dd></div>
              <div><dt>道具</dt><dd>${esc(r.accessory || '—')}</dd></div>
              <div><dt>优先级</dt><dd>${r.priority ?? '<span class="dim">不参与仲裁</span>'}</dd></div>
              ${r.density ? `<div><dt>姿态密度</dt><dd>${r.density} /秒</dd></div>` : ''}
              ${r.mini ? `<div><dt>mini 收敛到</dt><dd><code>${esc(r.mini)}</code></dd></div>` : ''}
            </dl>
            <div class="trig">${r.triggers.length
    ? r.triggers.map((t) => `<span class="chip">${esc(t)}</span>`).join('')
    : '<span class="chip warn">没有触发源</span>'}</div>
          </div>
        </article>`;

  const sections = Object.entries(GROUP_TITLES)
    .filter(([g]) => grouped[g]?.length)
    .map(([g, [title, blurb]]) => `
      <section>
        <div class="head">
          <h2>${title} <span class="count">${grouped[g].length}</span></h2>
          <p>${blurb}</p>
        </div>
        <div class="grid">${grouped[g].map(card).join('')}</div>
      </section>`).join('');

  const total = rows.length;
  const withTrigger = rows.filter((r) => r.triggers.length).length;

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Maclawd — 动作状态总表</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
              background:#f4f1ea; color:#1e1e2e; }
      * { box-sizing:border-box; }
      body { margin:0; padding:44px 24px 80px; }
      main { width:min(1320px,100%); margin:0 auto; }
      h1 { margin:0 0 12px; font-size:clamp(30px,4vw,46px); letter-spacing:-.03em; }
      .lede { max-width:780px; margin:0 0 6px; color:#50505e; line-height:1.65; }
      .stats { display:flex; flex-wrap:wrap; gap:10px; margin:22px 0 10px; }
      .stat { padding:10px 14px; border-radius:14px; background:#fbfaf7;
              border:1px solid rgba(30,30,46,.1); font-size:13px; }
      .stat b { font-size:20px; display:block; letter-spacing:-.02em; }
      .note { max-width:780px; margin:18px 0 40px; padding:14px 16px; border-radius:14px;
              background:rgba(255,255,255,.55); border:1px solid rgba(30,30,46,.1);
              color:#626271; font-size:13.5px; line-height:1.65; }
      section { margin-bottom:46px; }
      .head { margin-bottom:16px; }
      .head h2 { margin:0 0 4px; font-size:26px; }
      .count { display:inline-block; margin-left:6px; padding:2px 9px; border-radius:999px;
               background:#1e1e2e; color:#fbfaf7; font-size:13px; vertical-align:middle; }
      .head p { margin:0; max-width:720px; color:#50505e; font-size:14px; line-height:1.6; }
      .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
      .act { border:1px solid rgba(30,30,46,.11); border-radius:20px; background:#fbfaf7;
             overflow:hidden; box-shadow:0 10px 30px rgba(30,30,46,.06); }
      .act.alias { opacity:.66; }
      .stage { aspect-ratio:1; background:
        linear-gradient(rgba(30,30,46,.035) 1px,transparent 1px),
        linear-gradient(90deg,rgba(30,30,46,.035) 1px,transparent 1px),#fff;
        background-size:22px 22px; display:grid; place-items:center; }
      object { width:100%; height:100%; image-rendering:pixelated; }
      .no-asset { font-size:12px; color:#9a9aa8; }
      .body { padding:14px 16px 18px; }
      .id { font:11px ui-monospace,SFMono-Regular,Menlo,monospace; color:#c67a62; }
      h3 { margin:3px 0 6px; font-size:18px; }
      .body p { margin:0 0 10px; font-size:13px; line-height:1.55; color:#50505e; }
      dl { margin:0 0 10px; font-size:12px; }
      dl div { display:flex; gap:8px; padding:2px 0; }
      dt { flex:none; width:82px; color:#8a8a99; }
      dd { margin:0; color:#3a3a48; }
      .dim { color:#a8a8b4; }
      .trig { display:flex; flex-wrap:wrap; gap:5px; }
      .chip { padding:3px 8px; border-radius:999px; background:#fff; font-size:10.5px;
              border:1px solid rgba(30,30,46,.12); color:#50505e;
              font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
      .chip.warn { background:#fdecea; border-color:#e6b0a6; color:#a8432c; }
      a { color:#a55f4c; }
      @media(max-width:560px){ body{padding:28px 14px 60px} .grid{grid-template-columns:1fr} }
    </style>
  </head>
  <body>
    <main>
      <h1>动作状态总表</h1>
      <p class="lede">这一页由契约生成，不是手写的——手写的表和契约必然漂移，
        而漂移之后它会变成一份看起来权威、实际在骗人的文档。</p>
      <div class="stats">
        <div class="stat"><b>${total}</b>个动作</div>
        <div class="stat"><b>${grouped.mini?.length ?? 0}</b>个 mini 档</div>
        <div class="stat"><b>${withTrigger}</b>个有触发源</div>
        <div class="stat"><b>${Object.keys(convergence).filter((k) => !k.startsWith('_')).length}</b>条收敛映射</div>
      </div>
      <div class="note">
        <b>怎么读这张表。</b><br>
        <b>优先级</b>数字越小越先显示。一台机器可能同时跑多个会话，但桌宠只有一只——
        谁上屏由这个数决定。「不参与仲裁」的是一次性插播或外壳反应，走另一条路。<br>
        <b>姿态密度</b>是屏幕上每秒变几次姿态，只有重做过运动的动作有这个数。
        重做前全套中位是 1.56，像素画待机循环的通常下限是 4。<br>
        <b>mini 收敛</b>是贴边收起后投影到哪一档。收敛表必须穷举声明，
        不允许靠 id 前缀推断——前缀推断在 <code>idle.drowsy</code> 与
        <code>interaction.drag</code> 这种地方一定会猜错。<br>
        另见：<a href="working-candidates">工作状态的 16 个候选</a> ·
        <a href="./">动作实验室</a>
      </div>
      ${sections}
    </main>
  </body>
</html>
`;

  await writeFile(join(ROOT, 'web/actions.html'), html);
  console.log(`生成 web/actions.html：${total} 个动作，${withTrigger} 个有触发源`);
  const orphans = rows.filter((r) => !r.triggers.length).map((r) => r.id);
  if (orphans.length) console.log(`  没有触发源的：${orphans.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
