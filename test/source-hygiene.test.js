import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 源文件卫生自检。
 *
 * 为什么需要这个测试：开发过程中**多次**遇到写入的模板字符串里出现 NUL 字节
 * （`dedupe.js` 和 `server.js` 各中过一次）。后果很隐蔽——
 *   - grep 会把文件当二进制，静默不匹配，让人以为代码不存在
 *   - `cell.indexOf('\0')` 这种意外「正确」的代码能跑通，但完全是运气
 * 语法检查抓不到，只有逐字节扫描能抓到。
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src', 'bin', 'test', 'web', 'design', 'mac/Sources'];
const EXTENSIONS = ['.js', '.mjs', '.json', '.html', '.md', '.swift'];

function collect() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(full);
    }
  };
  for (const dir of SCAN_DIRS) walk(join(REPO, dir));
  return files;
}

const FILES = collect();

test('扫描范围本身是有效的', () => {
  assert.ok(FILES.length > 20, `只找到 ${FILES.length} 个文件，扫描目录可能配错了`);
});

test('源文件不含 NUL 字节', () => {
  const bad = [];
  for (const file of FILES) {
    const buffer = readFileSync(file);
    const index = buffer.indexOf(0);
    if (index >= 0) {
      // 定位到行号，方便直接改
      const line = buffer.subarray(0, index).toString('utf8').split('\n').length;
      bad.push(`${relative(REPO, file)}:${line}`);
    }
  }
  assert.deepEqual(bad, [], `以下文件含 NUL 字节（grep 会把它们当二进制）:\n  ${bad.join('\n  ')}`);
});

test('源文件是合法 UTF-8 且不含替换字符', () => {
  const bad = [];
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8');
    // U+FFFD 说明原始字节不是合法 UTF-8，被解码器替换掉了。
    // 必须写转义码点——直接写那个字符会让本文件自己命中。
    if (text.includes('\uFFFD')) bad.push(relative(REPO, file));
  }
  assert.deepEqual(bad, [], `以下文件存在编码损坏:\n  ${bad.join('\n  ')}`);
});

test('JS 与 JSON 文件不含制表符缩进', () => {
  // 仓库统一用空格；混入 tab 会让对齐在不同编辑器里错位
  const bad = [];
  for (const file of FILES) {
    if (!/\.(js|mjs|json|swift)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/^\t/m.test(text)) bad.push(relative(REPO, file));
  }
  assert.deepEqual(bad, [], `以下文件用了 tab 缩进:\n  ${bad.join('\n  ')}`);
});

test('JSON 文件全部可解析', () => {
  const bad = [];
  for (const file of FILES) {
    if (!file.endsWith('.json')) continue;
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      bad.push(`${relative(REPO, file)}: ${err.message}`);
    }
  }
  assert.deepEqual(bad, [], `以下 JSON 无法解析:\n  ${bad.join('\n  ')}`);
});

test('web 页面的内联脚本没有语法错误', async () => {
  // 页面脚本挂了是白屏，而白屏在测试里不会自动暴露
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-inline-'));
  const bad = [];
  try {
    for (const file of FILES) {
      if (!file.endsWith('.html')) continue;
      const html = readFileSync(file, 'utf8');
      const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      blocks.forEach((code, i) => {
        const temp = join(dir, `inline-${i}.mjs`);
        writeFileSync(temp, code, 'utf8');
        try {
          execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' });
        } catch (err) {
          bad.push(`${relative(REPO, file)} 第 ${i + 1} 段: ${String(err.stderr).slice(0, 200)}`);
        }
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('web 页面引用的 DOM id 都存在', () => {
  const bad = [];
  for (const file of FILES) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(file, 'utf8');
    const declared = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set([...html.matchAll(/el\('([^']+)'\)/g)].map((m) => m[1]));
    for (const id of used) {
      if (!declared.has(id)) bad.push(`${relative(REPO, file)}: el('${id}') 无对应元素`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('设计文档引用的文件真实存在', () => {
  // 文档里指向不存在的源文件是常见的腐烂形式
  const bad = [];
  for (const file of FILES) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/`(src\/[\w./-]+\.(?:js|svg|json))`/g)) {
      const target = join(REPO, match[1]);
      try {
        statSync(target);
      } catch {
        bad.push(`${relative(REPO, file)} 引用了不存在的 ${match[1]}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});
