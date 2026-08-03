#!/usr/bin/env node
/**
 * 生成 design/animation-inventory.md：**每一个** SVG 素材及其对应状态。
 *
 * 与 `/actions` 总表的区别：总表只列契约里的动作（那是「产品有哪些状态」），
 * 这里列**磁盘上的每一个文件**（那是「仓库里有哪些素材」）。两者的差集
 * 恰恰是最容易出问题的地方——没人引用的素材会悄悄留着，
 * 而契约引用了但文件不在的会白屏。差集必须能一眼看到。
 *
 * 用法：node scripts/build-inventory.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadActions, loadConvergence } from '../src/runtime/server.js';
import { PRIORITY } from '../src/runtime/state-engine.js';
import { ANIMATIONS } from '../design/motion-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GROUPS = {
  primary: '主状态',
  modifier: '工作修饰',
  interaction: '互动与环境',
  lifecycle: '生命周期 / 生命感 / 自发',
  mini: 'mini（贴边）',
};

async function main() {
  const actions = loadActions();
  const convergence = loadConvergence();
  const specs = new Set(ANIMATIONS.map((a) => a.state));
  const dir = join(ROOT, 'src/animations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.svg')).sort();

  // 素材 → 引用它的动作（一个素材可能被多个动作引用，例如别名）
  const users = new Map();
  for (const a of actions) {
    if (!a.source) continue;
    const file = a.source.split('/').pop();
    if (!users.has(file)) users.set(file, []);
    users.get(file).push(a);
  }
  // 分档素材也算被引用
  for (const a of actions) {
    for (const level of a.tiers?.levels ?? []) {
      const file = level.source?.split('/').pop();
      if (!file) continue;
      if (!users.has(file)) users.set(file, []);
      if (!users.get(file).some((x) => x.id === a.id)) {
        users.get(file).push({ ...a, tierOf: a.id, minSessions: level.minSessions });
      }
    }
  }

  const rows = [];
  for (const file of files) {
    const svg = await readFile(join(dir, file), 'utf8');
    const state = svg.match(/class="(?:[a-z]+ )?state-([a-z0-9_-]+)"/)?.[1] ?? null;
    const title = svg.match(/<title>Maclawd ([^<]*)<\/title>/)?.[1] ?? null;
    rows.push({
      file,
      state,
      title,
      users: users.get(file) ?? [],
      spec: state ? specs.has(state) : false,
    });
  }

  const contracted = rows.filter((r) => r.users.length);
  const loose = rows.filter((r) => !r.users.length);

  const byGroup = {};
  for (const r of contracted) {
    const g = r.users[0].group;
    (byGroup[g] ??= []).push(r);
  }

  const cell = (s) => String(s ?? '—');
  const lines = [];
  lines.push('# 动画素材总清单');
  lines.push('');
  lines.push('**由 `scripts/build-inventory.mjs` 生成，请勿手改。**');
  lines.push('');
  lines.push('与 [`/actions` 总表](https://maclawd.vercel.app/actions) 的区别：');
  lines.push('总表列的是**契约里有哪些状态**，这里列的是**磁盘上有哪些文件**。');
  lines.push('两者的差集恰恰是最容易出问题的地方——没人引用的素材会悄悄留着，');
  lines.push('而契约引用了但文件不在的会白屏。所以差集单列一节。');
  lines.push('');
  lines.push(`素材文件 **${rows.length}** 个 · 被契约引用 **${contracted.length}** 个 · `
    + `未引用 **${loose.length}** 个 · 进了姿态谱（可生成变体）**${rows.filter((r) => r.spec).length}** 个`);
  lines.push('');

  for (const [g, label] of Object.entries(GROUPS)) {
    const list = byGroup[g];
    if (!list?.length) continue;
    lines.push(`## ${label}（${list.length}）`);
    lines.push('');
    lines.push('| 素材 | 动作名 | 状态 id | 优先级 | mini 收敛 | 姿态谱 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of list) {
      const ids = r.users.map((u) => (u.tierOf
        ? `${u.id}（≥${u.minSessions} 档）`
        : u.id)).join('<br>');
      const prio = r.users.map((u) => PRIORITY[u.id]).find((x) => x !== undefined);
      const mini = r.users.map((u) => convergence[u.id]).find(Boolean);
      lines.push(`| \`${r.file}\` | ${cell(r.title)} | \`${ids}\` | ${cell(prio)} `
        + `| ${mini ? `\`${mini}\`` : '—'} | ${r.spec ? '✓' : '—'} |`);
    }
    lines.push('');
  }

  lines.push(`## 未被契约引用（${loose.length}）`);
  lines.push('');
  lines.push('这些不是死文件——大部分是**等待挑选的候选**。');
  lines.push('但它们不会被运行时播放，也不参与变体生成（给候选做变体是套娃）。');
  lines.push('');
  lines.push('| 素材 | 标题 | 状态 class | 说明 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of loose) {
    const note = /^work-[a-z]-/.test(r.file) ? '工作状态候选，见 /working-candidates'
      : /^work-tier/.test(r.file) ? '并发分档占位，动作待定'
        : r.state ? '' : '早期概念稿，无 state class';
    lines.push(`| \`${r.file}\` | ${cell(r.title)} | ${r.state ? `\`${r.state}\`` : '—'} | ${note} |`);
  }
  lines.push('');

  await writeFile(join(ROOT, 'design/animation-inventory.md'), lines.join('\n'));
  console.log(`生成 design/animation-inventory.md：${rows.length} 个素材`
    + `（引用 ${contracted.length} / 未引用 ${loose.length}）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
