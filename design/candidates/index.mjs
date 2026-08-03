/**
 * 把 design/candidates/ 下的手工候选拼成一张表。
 *
 * 一个动作一个文件是为了让多个人（或多个 agent）能并行写而不冲突。
 * 这里只负责拼装与校验，不做任何设计决策。
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function loadCandidates() {
  const files = (await readdir(HERE))
    .filter((f) => f.endsWith('.mjs') && f !== 'index.mjs')
    .sort();
  const all = [];
  const seen = new Set();
  for (const file of files) {
    const mod = await import(join(HERE, file));
    for (const c of mod.CANDIDATES ?? []) {
      // id 撞车会让后写的静默覆盖先写的——两个 agent 各自以为自己的生效了
      if (seen.has(c.id)) throw new Error(`候选 id 重复：${c.id}（来自 ${file}）`);
      if (!c.axis) throw new Error(`${c.id} 没写 axis——「换了哪条轴」是必填的`);
      seen.add(c.id);
      all.push({ ...c, file });
    }
  }
  return all;
}
