import { ONESHOT } from './state-engine.js';
import { geometryFor } from './hit-geometry.js';

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

/** mini 收敛不到任何一档时的兜底。宁可演错也不能白屏。 */
const MINI_DEFAULT = 'mini.idle';

export function createOrchestrator({
  actions = [], reducedMotion = false, convergence = {}, contract = null,
} = {}) {
  const byId = new Map();
  // 39 → 8 的收敛表来自 design/mini-actions.json，**穷举声明**。
  // 不靠 id 前缀推断：那在 `idle.drowsy`（该收敛到 idle 档）与
  // `interaction.drag`（该收敛到 peek 档）这类地方一定会猜错，
  // 而且新增动作时会静默落到默认档，没人会发现。
  const mini = new Map(Object.entries(convergence).filter(([key]) => !key.startsWith('_')));
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
   * 把主形态动作收敛到 mini 档。
   *
   * 表里没有直接命中时，沿回落链找有映射的祖先
   * （`working.something-new` → `working` → mini.busy），
   * 这样新增修饰不会立刻掉档。真的一个都找不到才用默认档，
   * 但会标 `unmapped`——**静默兜底等于把缺口藏起来**，
   * 探针和测试要能看见它。
   */
  function converge(actionId) {
    const id = String(actionId ?? '');
    // fallbackChain 末尾无条件补一个 `idle`，那是「找不到资产时别白屏」的兜底。
    // 收敛**不能**把它当成一次成功匹配：否则任何未知 id 都会静默变成 mini.idle，
    // unmapped 永远为假，缺口就再也看不见了。只有 idle 本来就是这个 id 的
    // 祖先（`idle` / `idle.*`）时才算数。
    const idleIsAncestor = id === 'idle' || id.startsWith('idle.');
    const chain = fallbackChain(id).filter((c) => c !== 'idle' || idleIsAncestor);
    for (const candidate of chain) {
      const hit = mini.get(candidate);
      if (hit) {
        return { id: hit, convergedFrom: id, unmapped: false, inexact: candidate !== id };
      }
    }
    return { id: MINI_DEFAULT, convergedFrom: id, unmapped: true, inexact: true };
  }

  /**
   * @returns {null | {
   *   actionId, name, source, durationMs, mode, variant,
   *   next: string|null, motion: boolean, fellBackFrom: string|null,
   *   convergedFrom: string|null, unmapped: boolean
   * }}
   */
  /**
   * 按并发会话数挑素材。
   *
   * **状态 id 不变**——tier 是渲染层的事，状态机与优先级表都不该知道它。
   * levels 按 minSessions 降序取第一个满足的；一个都不满足就用动作本身的素材。
   *
   * 参考 clawd-on-desk 的机制，但不抄它的映射：它用「戴耳机摇摆」表示
   * 2 个会话，用户读不出这个对应关系——那是换皮不是传信息。
   * 我们让数量本身可见，几条流水线就是几个会话。
   */
  function pickTier(action, busy) {
    const levels = action.tiers?.levels;
    if (!Array.isArray(levels) || !Number.isFinite(busy)) return null;
    const sorted = [...levels].sort((a, b) => b.minSessions - a.minSessions);
    for (const level of sorted) {
      if (busy >= level.minSessions && level.source) return level;
    }
    return null;
  }

  function plan(actionId, {
    variant = null, reduced = reducedMotion, mini: miniMode = false, busy = null,
  } = {}) {
    // mini 是主状态的**投影**，不是第二套状态机——引擎照常产出 39 档之一，
    // 收敛只发生在这一步。绝不为 mini 建独立状态机，那必然漂移。
    const converged = miniMode ? converge(actionId) : null;
    const found = resolve(converged ? converged.id : actionId);
    if (!found) return null;
    const { action, fellBackFrom, aliasedFrom } = found;

    const isOneshot = action.mode === 'oneshot' || ONESHOT.has(action.id);
    // 一次性动作播完要回到某个循环态；契约里的 exit 是 'event-driven' 时交回引擎。
    const exit = typeof action.exit === 'string' && action.exit !== 'event-driven'
      ? action.exit
      : null;

    // mini 档不分档：取景已经裁到只剩演员，几条流水线都放不下。
    const tier = miniMode ? null : pickTier(action, busy);

    return {
      actionId: action.id,
      name: tier?.name ?? action.name,
      source: tier?.source ?? action.source,
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
      // 收敛与回落也是两回事：收敛是 mini 档的刻意合并，不是缺资产。
      convergedFrom: converged && converged.inexact ? converged.convergedFrom : null,
      unmapped: converged ? converged.unmapped : false,
      // 命中区与可见画面框，随动作变。外壳直接用，不在 Swift 里再算一遍——
      // 契约是唯一来源。mini 档整个窗口就是角色，不需要收窄。
      geometry: miniMode ? null : geometryFor(action.id, contract),
      // 面板与测试要能看出「现在播的是第几档、是不是占位素材」。
      // 不暴露的话，分档在画面上生效了却无从解释，占位也会悄悄变成成品。
      tier: tier ? { minSessions: tier.minSessions, placeholder: !!tier.placeholder } : null,
    };
  }

  return {
    plan,
    resolve,
    converge,
    has: (actionId) => byId.has(actionId),
    ids: () => [...byId.keys()],
    miniIds: () => [...new Set(mini.values())],
  };
}
