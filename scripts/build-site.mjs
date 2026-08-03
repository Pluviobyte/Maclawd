#!/usr/bin/env node
/**
 * 把仓库里的页面组装成一个可以静态托管的演示站（输出到 `site/`）。
 *
 * 为什么需要一个构建步骤，而不是直接把 `web/` 传上去：
 *
 * 1. **本地面板必须保持原样。** 演示兜底脚本只注入到 `site/` 里的副本。
 *    如果本地页面在服务挂掉时悄悄显示演示数据，用户会以为那是自己的数据——
 *    比直接报错糟得多。所以两份行为必须分开，而分开的位置就是这里。
 *
 * 2. **状态引擎要打成经典脚本。** `state-engine.js` / `orchestrator.js` 零依赖，
 *    能直接在浏览器里跑，于是演示站可以跑**真的仲裁逻辑**而不是一份手写近似。
 *    但页面的引导脚本是经典 `<script>`（同步执行），ESM 模块是延迟执行的，
 *    兜底会赶不上第一次 fetch。所以这里把两个模块转成一个 IIFE 提前加载。
 *
 * 3. **动作清单要注入。** 演示站没有服务端读 design/*.json。
 *
 * 用法：node scripts/build-site.mjs
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadActions } from '../src/runtime/server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site');
const read = (rel) => readFile(join(ROOT, rel), 'utf8');
const write = async (rel, text) => {
  const target = join(OUT, rel);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
};

/**
 * 把我们自己的 ESM 模块转成一个经典脚本。
 *
 * 这不是通用打包器，只处理这两个文件实际用到的形态：
 * 行首的 `export const` / `export function`，以及模块间的相对 import。
 * 之所以敢这么做，是因为这两个文件是我们自己的，形态由我们控制；
 * 构建时会断言这一点，形态一变就报错，而不是悄悄产出坏包。
 */
async function bundleEngine() {
  const parts = [];
  // 顺序即依赖顺序：orchestrator 用 hit-geometry，必须排在它后面。
  for (const rel of ['src/runtime/state-engine.js', 'src/runtime/hit-geometry.js',
    'src/runtime/orchestrator.js']) {
    const src = await read(rel);
    for (const line of src.split('\n')) {
      // 只允许相对 import（模块间互相引用），其余一律说明形态变了。
      if (/^\s*import\s/.test(line) && !/from\s+'\.\//.test(line)) {
        throw new Error(`${rel} 出现了非相对 import，无法打成经典脚本：${line.trim()}`);
      }
      if (/^\s*export\s+(default|\*|\{)/.test(line)) {
        throw new Error(`${rel} 出现了未支持的导出形态：${line.trim()}`);
      }
    }
    parts.push(src
      .split('\n')
      .filter((line) => !/^\s*import\s/.test(line))
      .map((line) => line.replace(/^export\s+/, ''))
      .join('\n'));
  }
  const exposed = ['createStateEngine', 'createOrchestrator', 'PRIORITY', 'energyFrom'];
  return '/* 由 scripts/build-site.mjs 从 src/runtime/ 生成，请勿直接编辑。 */\n'
    + '(function(){\n' + parts.join('\n') + '\n'
    + `window.MaclawdEngine = { ${exposed.join(', ')} };\n})();\n`;
}

/** 在 </head> 前插入脚本；顺序即执行顺序。 */
function injectHead(html, tags) {
  if (!html.includes('</head>')) throw new Error('页面缺少 </head>，无法注入');
  return html.replace('</head>', `${tags}\n</head>`);
}

const DEMO_TAGS = [
  '<script src="/demo-engine.js"></script>',
  '<script src="/demo-data.js"></script>',
  '<script src="/demo-actions.js"></script>',
  '<script src="/demo-mode.js"></script>',
].map((t) => '  ' + t).join('\n');

/**
 * 演示站把动作实验室放在 `/`，所以面板的导航要重指。
 * 本地服务里 `/` 就是宠物管理页，这个差异只存在于演示站。
 */
function rewriteNav(html) {
  const out = html
    .replace('<a href="/" aria-current="page">宠物管理</a>', '<a href="/pet" aria-current="page">宠物管理</a>')
    .replace('<a href="/">宠物管理</a>', '<a href="/pet">宠物管理</a>');
  return out.replace(
    /(<a href="\/usage"[^>]*>用量统计<\/a>)/,
    '$1\n    <a href="/">动作实验室</a>',
  );
}

/**
 * 清空产物目录，但**保留 `.vercel`**。
 *
 * 那是托管平台的项目链接。连它一起删掉的话，下次部署会按目录名
 * 新建一个叫 `site` 的项目，而不是更新原来那个——已经踩过一次。
 */
async function cleanOutput() {
  let entries;
  try {
    entries = await readdir(OUT);
  } catch {
    await mkdir(OUT, { recursive: true });
    return;
  }
  for (const name of entries) {
    if (name === '.vercel') continue;
    await rm(join(OUT, name), { recursive: true, force: true });
  }
}

async function main() {
  await cleanOutput();
  await mkdir(OUT, { recursive: true });

  // 动作实验室：本来就是纯静态的，原样搬过去，只加一条去面板的导航。
  const lab = await read('index.html');
  await write('index.html', lab.replace(
    '<div id="lab"></div>',
    '<p class="note" style="margin:0 0 26px">'
    + `这 ${loadActions().length} 个动作由运行时按状态调度。`
    + '<a href="/actions">动作状态总表</a> · '
    + '<a href="/working-candidates">工作状态候选</a> · '
    + '<a href="/candidates">手工设计候选</a> · '
    + '<a href="/pet">宠物管理面板</a> · <a href="/usage">用量统计面板</a>'
    + '（演示数据，桌宠状态跑的是真引擎）</p>\n      <div id="lab"></div>',
  ));

  // 面板：注入演示兜底 + 改导航。
  for (const [src, dest] of [['web/pet.html', 'pet.html'], ['web/usage.html', 'usage.html'], ['web/mobile.html', 'mobile.html']]) {
    await write(dest, injectHead(rewriteNav(await read(src)), DEMO_TAGS));
  }

  // 候选对比页：纯静态，不需要演示兜底。
  await write('working-candidates.html', await read('web/working-candidates.html'));

  // 动作总表：**每次构建都重新生成**。只在改动作时手动跑一次的话，
  // 它迟早会停在某个旧版本上，而一份过期的「总表」比没有更误导。
  await import('./build-action-catalog.mjs');
  await write('actions.html', await read('web/actions.html'));

  // 候选变体浏览页。变体 CSS 已经在共享样式表里（build-variants.mjs 写的），
  // 这里只需要把页面和数据搬过去。
  try {
    await write('variants.html', await read('web/variants.html'));
    await write('variant-data.js', await read('web/variant-data.js'));
  } catch {
    // 变体页还没生成时不阻断整个站点构建
  }

  // 手工候选（design/candidates/）。与参数化变体是两回事：
  // 变体是同一个设计的五种调法，候选是**换一个设计**。
  try {
    await write('candidates.html', await read('web/candidates.html'));
    await write('candidate-data.js', await read('web/candidate-data.js'));
  } catch {
    // 还没有手工候选时不阻断构建
  }

  await write('demo-engine.js', await bundleEngine());
  await write('demo-data.js', await read('web/demo-data.js'));
  await write('demo-mode.js', await read('web/demo-mode.js'));

  const actions = loadActions();
  await write('demo-actions.js',
    '/* 由 scripts/build-site.mjs 从 design/*.json 生成。 */\n'
    + `window.MaclawdDemo.actions = ${JSON.stringify(actions)};\n`);

  // 页面用 <object data="/src/animations/*.svg"> 引用，路径必须保持。
  await cp(join(ROOT, 'src/animations'), join(OUT, 'src/animations'), { recursive: true });
  // 实验室页脚链到概念档案。
  await cp(join(ROOT, 'design/concepts'), join(OUT, 'design/concepts'), { recursive: true });

  await write('vercel.json', JSON.stringify({
    cleanUrls: true,
    trailingSlash: false,
    headers: [{
      source: '/(.*)',
      headers: [
        // 演示站没有任何后端，把出网能力也一并关掉：
        // 万一某天有人往页面里加了外部请求，这里会先拦下来。
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }],
  }, null, 2) + '\n');

  console.log(`site/ 已生成：${actions.length} 个动作条目`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
