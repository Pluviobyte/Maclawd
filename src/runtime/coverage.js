/**
 * 动作覆盖记录。
 *
 * **为什么需要它。**
 * 这个项目已经三次出现「动作画好了、契约里列着、但用户永远看不到」，
 * 每次都是靠人逐个手查才发现的：`waiting` 不在优先级表里、
 * `waking` 压根没有触发源、全部外壳动作被驻留挡住。
 *
 * test/action-reachability.test.js 现在能挡住这一类了——但它证明的是
 * **合成场景下能上屏**。那和「真实使用中会上屏」是两件事：
 * 一个动作可能技术上完全可达，却因为它的触发条件在日常里根本不出现、
 * 或者每次只闪几十毫秒，而事实上从没被看见过。这种情况没有任何测试会红，
 * 也没有人会注意到——你不会记得「今天 Suitcase Fold 到底演过没有」。
 *
 * 所以这里记真实数据：每个动作**实际上过屏几次、总共多久、最近一次是什么时候**。
 * 用一天之后，`maclawd-usage coverage` 直接给出三类：
 *   - 从没出现过
 *   - 出现过但每次都短得看不清
 *   - 正常
 *
 * **只记 actionId 与时长**，不记会话、不记项目、不记任何内容——
 * 它回答的是「这个动作有没有被看见」，不需要知道当时在干什么。
 */

/** 低于这个时长的一次露面，人眼基本抓不住。 */
const GLIMPSE_MS = 900;

export function createCoverage(initial = {}) {
  /** actionId → { count, totalMs, maxMs, lastAt, glimpses } */
  const seen = new Map(Object.entries(initial.actions ?? {}));
  let currentId = null;
  let currentSince = 0;
  let dirty = false;

  const entry = (id) => {
    let e = seen.get(id);
    if (!e) {
      e = { count: 0, totalMs: 0, maxMs: 0, lastAt: 0, glimpses: 0 };
      seen.set(id, e);
    }
    return e;
  };

  /** 结算上一个动作的这一次露面。 */
  function close(now) {
    if (!currentId) return;
    const shown = Math.max(0, now - currentSince);
    const e = entry(currentId);
    e.count += 1;
    e.totalMs += shown;
    e.maxMs = Math.max(e.maxMs, shown);
    e.lastAt = now;
    if (shown < GLIMPSE_MS) e.glimpses += 1;
    dirty = true;
  }

  return {
    /** 状态引擎每次换动作时调用。 */
    observe(actionId, now) {
      if (!actionId || actionId === currentId) return;
      close(now);
      currentId = actionId;
      currentSince = now;
    },

    /**
     * 把**当前**这一次也结算进去，用于导出快照。
     *
     * 不结算的话，一个已经显示了两小时的动作在报告里会是 0 次——
     * 而那恰恰是最该被看到的数据。
     */
    snapshot(now) {
      const out = {};
      for (const [id, e] of seen) out[id] = { ...e };
      if (currentId) {
        const shown = Math.max(0, now - currentSince);
        const live = out[currentId] ?? { count: 0, totalMs: 0, maxMs: 0, lastAt: 0, glimpses: 0 };
        out[currentId] = {
          count: live.count + 1,
          totalMs: live.totalMs + shown,
          maxMs: Math.max(live.maxMs, shown),
          lastAt: now,
          glimpses: live.glimpses + (shown < GLIMPSE_MS ? 1 : 0),
        };
      }
      return { actions: out, since: initial.since ?? null };
    },

    /** 有没有需要落盘的新数据。 */
    get dirty() { return dirty; },
    markClean() { dirty = false; },
  };
}

/**
 * 把快照分成三档。
 *
 * @param {object} snapshot createCoverage().snapshot() 的产物
 * @param {string[]} known 契约里声明的全部动作 id
 */
export function classify(snapshot, known) {
  const actions = snapshot.actions ?? {};
  const never = [];
  const glimpsed = [];
  const normal = [];

  for (const id of known) {
    const e = actions[id];
    if (!e || e.count === 0) { never.push({ id }); continue; }
    const row = {
      id,
      count: e.count,
      totalMs: e.totalMs,
      maxMs: e.maxMs,
      lastAt: e.lastAt,
      glimpses: e.glimpses,
    };
    // 每一次都短得看不清 = 技术上出现过，实际从没被看见
    if (e.maxMs < GLIMPSE_MS) glimpsed.push(row);
    else normal.push(row);
  }

  const rank = (a, b) => b.totalMs - a.totalMs;
  return { never, glimpsed: glimpsed.sort(rank), normal: normal.sort(rank) };
}

export { GLIMPSE_MS };
