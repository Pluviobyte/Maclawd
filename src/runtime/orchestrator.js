import { ONESHOT } from './state-engine.js';

/**
 * 动画编排器：状态 id → 可播放的动作。
 *
 * 纯函数式规划，不碰 DOM——浏览器与 Swift 外壳各自按这份计划渲染。
 *
 * 回落链是关键：状态引擎可能给出没有独立 SVG 的 id（例如别名 `working.command`，
 * 或某个修饰还没画）。这时必须逐级回落而不是白屏——
 * 主状态契约要求「没有可靠依据时回落通用动作」。
 */

/** 逐级去掉后缀：working.reading → working → idle。 */
export function fallbackChain(actionId) {
  const chain = [];
  let id = String(actionId ?? '');
  while (id) {
    chain.push(id);
    const dot = id.lastIndexOf('.');
    if (dot <= 0) break;
    id = id.slice(0, dot);
  }
  if (!chain.includes('idle')) chain.push('idle');
  return chain;
}

export function createOrchestrator({ actions = [], reducedMotion = false } = {}) {
  const byId = new Map();
  // 契约里的显式别名。`ambient.power_connected` 就刻意复用 `waking`
  // （Morning Stretch）——「能量回来了」本身就读得懂，不需要再加充电器道具。
  // 早先版本忽略了 mapsTo，于是它一路回落到 idle，别名等于没生效。
  const aliases = new Map();
  for (const action of actions) {
    if (!action?.id) continue;
    if (typeof action.mapsTo === 'string' && action.mapsTo) {
      aliases.set(action.id, action.mapsTo);
    }
    // 同一 id 可能在多个契约文件里出现，先到先得（主状态契约排在最前）。
    if (action.source && !byId.has(action.id)) byId.set(action.id, action);
  }

  function resolve(actionId) {
    // 别名优先于回落链：它是契约的明确指定，不是猜测。
    const alias = aliases.get(actionId);
    if (alias && byId.has(alias)) {
      return { action: byId.get(alias), fellBackFrom: null, aliasedFrom: actionId };
    }
    for (const candidate of fallbackChain(actionId)) {
      const hit = byId.get(candidate);
      if (hit) return { action: hit, fellBackFrom: candidate === actionId ? null : actionId };
    }
    return null;
  }

  /**
   * @returns {null | {
   *   actionId, name, source, durationMs, mode, variant,
   *   next: string|null, motion: boolean, fellBackFrom: string|null
   * }}
   */
  function plan(actionId, { variant = null, reduced = reducedMotion } = {}) {
    const found = resolve(actionId);
    if (!found) return null;
    const { action, fellBackFrom, aliasedFrom } = found;

    const isOneshot = action.mode === 'oneshot' || ONESHOT.has(action.id);
    // 一次性动作播完要回到某个循环态；契约里的 exit 是 'event-driven' 时交回引擎。
    const exit = typeof action.exit === 'string' && action.exit !== 'event-driven'
      ? action.exit
      : null;

    return {
      actionId: action.id,
      name: action.name,
      source: action.source,
      // 减弱动效下不缩短时长，只是不播放位移——时长是契约锁定的。
      durationMs: action.durationMs ?? null,
      mode: isOneshot ? 'oneshot' : 'loop',
      variant: variant && action.variants?.includes(variant) ? variant : null,
      next: isOneshot ? exit : null,
      // 道具与身体动作停止，只保留低频眨眼（共享减弱动效行为）。
      motion: !reduced,
      fellBackFrom,
      // 别名与回落是两回事：别名是契约指定的复用，回落是找不到资产的兜底。
      aliasedFrom: aliasedFrom ?? null,
    };
  }

  return {
    plan,
    resolve,
    has: (actionId) => byId.has(actionId),
    ids: () => [...byId.keys()],
  };
}
