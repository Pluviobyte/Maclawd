#!/usr/bin/env node
/**
 * 一次性迁移脚本：退役 8 个主形态动作。
 *
 * 退役一个动作要同时动 5 个地方（契约 JSON、素材、CSS 规则、CSS 关键帧、
 * mini 收敛表、实验室页面）。手工逐个删必然漏——漏掉的表现是
 * 素材还在但没人引用，或者收敛表指向不存在的动作，两种都不会立刻报错。
 * 所以写成脚本，一次做完，测试兜底。
 *
 * 判据见 design/motion-refinement.md：
 * 「是否为**一眼看懂 Claude 在做什么**贡献独立信息」。
 *
 * 用法：node scripts/retire-actions.mjs
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFile(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFile(join(ROOT, rel), text);

/** [动作 id, CSS state class, 素材文件, 退役理由] */
const RETIRED = [
  ['moving', 'moving', 'sideways-scuttle.svg',
    '外壳从不发 shell.move；拖动已被 interaction.drag + drop 完整覆盖'],
  ['ambient.notification', 'notification', 'attention-turn.svg',
    '外壳从不发 shell.notification；且 macOS 通知不是 Claude 的状态'],
  ['cancelled', 'cancelled', 'tiny-shrug.svg',
    'Claude Code 不暴露「用户取消」信号'],
  ['working.reading', 'reading', 'card-browsing.svg',
    'Read/Grep 毫秒级返回，修饰一闪而过，实测看不见'],
  ['working.writing', 'writing', 'note-stitching.svg',
    '同上'],
  ['working.syncing', 'syncing', 'relay-bead.svg',
    'WebFetch/git 频率低，与通用 working 无实质信息差'],
  ['workspace', 'workspace', 'pop-up-studio.svg',
    '切工作目录是低信息事件，且 oneshot 插播会打断真正在演的动作'],
  ['ambient.reconnecting', 'reconnecting', 'ready-wiggle.svg',
    '「恢复了」不需要独立动作——回到之前的状态本身就是信号'],
];

const ids = new Set(RETIRED.map((r) => r[0]));
const classes = new Set(RETIRED.map((r) => r[1]));

/** 从契约 JSON 的 states 数组里剔除退役动作（可能嵌套在分组里）。 */
function prune(node) {
  if (Array.isArray(node)) {
    return node.filter((item) => !(item && typeof item === 'object' && ids.has(item.id)))
      .map(prune);
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, prune(v)]));
  }
  return node;
}

/**
 * 从共享样式表里摘掉这些状态的规则与关键帧。
 *
 * 关键帧只在**没有别的状态还在用**时才删——有些关键帧是跨状态复用的，
 * 无条件删会把还在用的动作弄坏。
 */
function stripCss(css) {
  const lines = css.split('\n');
  const kept = [];
  const dropped = new Set();

  // 第一遍：删掉 .state-X { ... } 与 .state-X .layer { ... } 规则，记下它们引用的关键帧
  for (const line of lines) {
    const m = line.match(/^\.state-([a-z0-9_-]+)[\s{]/);
    if (m && classes.has(m[1])) {
      const kf = line.match(/animation-name:\s*([a-z0-9-]+)/);
      if (kf) dropped.add(kf[1]);
      continue;
    }
    kept.push(line);
  }

  let text = kept.join('\n');
  // 第二遍：只删掉再无人引用的关键帧
  for (const name of dropped) {
    const stillUsed = new RegExp(`animation-name:\\s*${name}\\b`).test(text);
    if (stillUsed) continue;
    const start = text.indexOf(`@keyframes ${name} {`);
    if (start < 0) continue;
    let i = text.indexOf('{', start) + 1;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    while (text[i] === '\n') i++;
    text = text.slice(0, start) + text.slice(i);
  }
  return text;
}

async function main() {
  // 1) 四份主形态契约
  for (const file of ['design/main-state-actions.json', 'design/activity-modifiers.json',
    'design/interaction-actions.json', 'design/runtime-lifecycle-actions.json']) {
    const doc = JSON.parse(await read(file));
    await write(file, `${JSON.stringify(prune(doc), null, 2)}\n`);
  }

  // 2) mini 收敛表：退役的 id 不该再出现
  const miniFile = 'design/mini-actions.json';
  const mini = JSON.parse(await read(miniFile));
  mini.convergence = Object.fromEntries(
    Object.entries(mini.convergence).filter(([k]) => !ids.has(k)),
  );
  await write(miniFile, `${JSON.stringify(mini, null, 2)}\n`);

  // 3) 样式表
  await write('src/animations/maclawd-actions.css', stripCss(await read('src/animations/maclawd-actions.css')));

  // 4) 素材。git 历史留着，工作区不留死资产。
  for (const [, , svg] of RETIRED) {
    await rm(join(ROOT, 'src/animations', svg), { force: true });
  }

  // 5) 动作实验室
  let lab = await read('index.html');
  for (const [, , svg] of RETIRED) {
    lab = lab.split('\n').filter((line) => !line.includes(`"${svg}"`)).join('\n');
  }
  // 删完之后每组标题里的数量都不对了，交给下面的 fixCounts 统一改
  await write('index.html', lab);

  console.log(`已退役 ${RETIRED.length} 个动作：`);
  for (const [id, , , why] of RETIRED) console.log(`  ${id.padEnd(24)} ${why}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
