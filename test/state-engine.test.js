import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBash, createStateEngine, energyFrom, idleWeights, pickWeighted, PRIORITY,
} from '../src/runtime/state-engine.js';
import { createOrchestrator, fallbackChain } from '../src/runtime/orchestrator.js';

const SEC = 1000;
/** 固定随机源，让权重效果可确定断言。 */
const fixed = (value) => () => value;

/**
 * 映射逻辑的单测默认关掉最小驻留——它们验证的是「什么事件对应什么状态」，
 * 不该和时序耦合。驻留本身由下面专门的用例覆盖。
 */
function engine(options = {}) {
  return createStateEngine({ random: fixed(0.999), minDwellMs: 0, ...options });
}

// ---------- 优先级与仲裁 ----------

test('优先级顺序符合设计：要人决定最高', () => {
  assert.ok(PRIORITY.needs_owner < PRIORITY.error);
  assert.ok(PRIORITY.error < PRIORITY.compacting);
  assert.ok(PRIORITY.compacting < PRIORITY.delegating);
  assert.ok(PRIORITY.delegating < PRIORITY['working.reading']);
  assert.ok(PRIORITY['working.reading'] < PRIORITY.working);
  assert.ok(PRIORITY.working < PRIORITY.thinking);
  assert.ok(PRIORITY.thinking < PRIORITY.idle);
});

test('多会话取优先级最高的那个', () => {
  const e = engine();
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 'a' }, 1 * SEC);
  e.observeEvent({ type: 'PreToolUse', sessionId: 'b', toolName: 'Read' }, 2 * SEC);
  assert.equal(e.current().actionId, 'working.reading', 'b 的工作修饰压过 a 的 thinking');

  // a 卡住等人 → 立刻抢占
  e.observeEvent({ type: 'PermissionRequest', sessionId: 'a' }, 3 * SEC);
  assert.equal(e.current().actionId, 'needs_owner');
  assert.equal(e.current().sessionId, 'a');
});

test('同优先级取最近事件的会话', () => {
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read' }, 1 * SEC);
  e.observeEvent({ type: 'PreToolUse', sessionId: 'b', toolName: 'Write' }, 2 * SEC);
  assert.equal(e.current().sessionId, 'b');
  assert.equal(e.current().actionId, 'working.writing');
});

test('会话静默后退出活跃集，不会永远占着状态', () => {
  const e = engine({ sessionIdleMs: 10 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 'a' }, 1 * SEC);
  e.tick(5 * SEC);
  e.tick(60 * SEC);
  assert.ok(e.debug().sessions.length === 0, '静默会话应被清理');
});

// ---------- 工具名 → 修饰 ----------

test('可靠的 tool_name 直接升级到具体修饰', () => {
  const e = engine();
  const cases = [
    ['Read', 'working.reading'],
    ['Grep', 'working.reading'],
    ['Edit', 'working.writing'],
    ['WebFetch', 'working.syncing'],
  ];
  let t = 0;
  for (const [tool, expected] of cases) {
    t += SEC;
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: tool }, t);
    assert.equal(e.current().actionId, expected, tool);
  }
});

test('未知工具回落通用 working，不臆造任务', () => {
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: '某个新工具' }, SEC);
  assert.equal(e.current().actionId, 'working');
});

test('Bash 只在高置信度模式下细分，否则回落通用', () => {
  assert.equal(classifyBash('npm test'), 'working.testing');
  assert.equal(classifyBash('pytest -q tests/'), 'working.testing');
  assert.equal(classifyBash('npm run build'), 'working.building');
  assert.equal(classifyBash('cargo build --release'), 'working.building');
  assert.equal(classifyBash('git push origin main'), 'working.syncing');
  // 这些看不出意图，必须回落——契约不允许从不可靠信号编出任务
  assert.equal(classifyBash('ls -la'), 'working');
  assert.equal(classifyBash('echo hello'), 'working');
  assert.equal(classifyBash(''), 'working');
  assert.equal(classifyBash(undefined), 'working');
});

// ---------- 子代理变体 ----------

test('delegating 的变体按并发子代理数切换', () => {
  const e = engine();
  e.observeEvent({ type: 'SubagentStart', sessionId: 's', agentId: 'a1' }, SEC);
  assert.equal(e.current().actionId, 'delegating');
  assert.equal(e.current().variant, 'one-subagent');

  e.observeEvent({ type: 'SubagentStart', sessionId: 's', agentId: 'a2' }, 2 * SEC);
  assert.equal(e.current().variant, 'two-or-more-subagents');

  e.observeEvent({ type: 'SubagentStop', sessionId: 's', agentId: 'a2' }, 3 * SEC);
  assert.equal(e.current().variant, 'one-subagent');

  e.observeEvent({ type: 'SubagentStop', sessionId: 's', agentId: 'a1' }, 4 * SEC);
  assert.equal(e.current().actionId, 'working', '子代理清空后回到工作');
});

// ---------- 一次性动作与状态链 ----------

test('Stop 插播 success 后回到循环态', () => {
  const e = engine();
  e.observeEvent({ type: 'Stop', sessionId: 's' }, 10 * SEC);
  assert.equal(e.current().actionId, 'success');
  // 插播窗口内不切换
  e.tick(11 * SEC);
  assert.equal(e.current().actionId, 'success');
  // 窗口过后回落
  e.tick(20 * SEC);
  assert.notEqual(e.current().actionId, 'success');
});

test('权限被批准后插播 owner_resolved，闭合 needs_owner 的故事', () => {
  const e = engine();
  e.observeEvent({ type: 'PermissionRequest', sessionId: 's' }, SEC);
  assert.equal(e.current().variant, 'permission');
  e.observeEvent({ type: 'PermissionResolved', sessionId: 's' }, 2 * SEC);
  assert.equal(e.current().actionId, 'owner_resolved');
});

test('没有待批准权限时不插播 owner_resolved', () => {
  const e = engine();
  e.observeEvent({ type: 'PermissionResolved', sessionId: 's' }, SEC);
  assert.equal(e.current().actionId, 'working');
});

test('StopFailure 进入 error 并带上 matcher 变体', () => {
  const e = engine();
  e.observeEvent({ type: 'StopFailure', sessionId: 's', matcher: 'rate_limit' }, SEC);
  assert.equal(e.current().actionId, 'error');
  assert.equal(e.current().variant, 'rate_limit');
  e.observeEvent({ type: 'ErrorResolved', sessionId: 's' }, 2 * SEC);
  assert.equal(e.current().actionId, 'recovering');
});

test('CwdChanged 插播 workspace', () => {
  const e = engine();
  e.observeEvent({ type: 'CwdChanged', sessionId: 's' }, SEC);
  assert.equal(e.current().actionId, 'workspace');
});

// ---------- 无 hook 的降级路径 ----------

test('只有速率时能区分 working / idle，但不细分任务', () => {
  const e = engine();
  e.observeRate(50_000, SEC);
  assert.equal(e.current().actionId, 'working', '速率只敢下通用忙碌');
  e.observeRate(0, 2 * SEC);
  assert.ok(e.current().actionId.startsWith('idle'));
});

test('速率低于阈值不算忙碌', () => {
  const e = engine();
  e.observeRate(10, SEC);
  assert.ok(e.current().actionId.startsWith('idle'));
});

test('hook 事件优先于速率推断', () => {
  const e = engine();
  e.observeRate(90_000, SEC);
  e.observeEvent({ type: 'PermissionRequest', sessionId: 's' }, 2 * SEC);
  assert.equal(e.current().actionId, 'needs_owner', '真实事件必须压过推断');
});

// ---------- 静默转场 ----------

test('静默足够久依次进入 away 与 sleeping', () => {
  // 满体力时 away 阈值 = 10s，sleeping 阈值 = 10 + 5 = 15s（相对最后一次活动）
  const e = engine({ awayMs: 10 * SEC, sleepMs: 5 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  e.tick(5 * SEC);
  assert.notEqual(e.current().actionId, 'away', '静默 4s 还不该离开');
  e.tick(12 * SEC);
  assert.equal(e.current().actionId, 'away', '静默 11s 进入 away');
  e.tick(20 * SEC);
  assert.equal(e.current().actionId, 'sleeping', '静默 19s 已经睡着');
});

test('体力越低越早进入 away', () => {
  const rested = engine({ awayMs: 100 * SEC });
  rested.setEnergy(1);
  rested.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  const restedThreshold = rested.debug().awayThresholdMs;

  const tired = engine({ awayMs: 100 * SEC });
  tired.setEnergy(0);
  tired.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  const tiredThreshold = tired.debug().awayThresholdMs;

  assert.ok(tiredThreshold < restedThreshold, `${tiredThreshold} 应小于 ${restedThreshold}`);
});

// ---------- 睡眠链与等待 ----------

test('从睡眠中被唤醒会插播 Morning Stretch，闭合睡眠链', () => {
  // 契约里 away → sleeping → waking 共用同一条毛毯，是一条连续的故事。
  // 此前 waking 没有任何触发源，引擎从 sleeping 直接跳到工作态，
  // 三个动作里有一个永远看不到。
  const e = engine({ awayMs: 10 * SEC, sleepMs: 5 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  e.tick(30 * SEC);
  assert.equal(e.current().actionId, 'sleeping');

  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, 31 * SEC);
  assert.equal(e.current().actionId, 'waking', '醒来必须先伸个懒腰');
  e.tick(36 * SEC);
  assert.equal(e.current().actionId, 'thinking', '插播结束回到真实状态');
});

test('速率推断同样能唤醒', () => {
  const e = engine({ awayMs: 10 * SEC, sleepMs: 5 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  e.tick(30 * SEC);
  e.observeRate(90_000, 31 * SEC);
  assert.equal(e.current().actionId, 'waking');
});

test('刚醒来时不叠加 launching，两个开场动作不打架', () => {
  const e = engine({ awayMs: 10 * SEC, sleepMs: 5 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  e.tick(30 * SEC);
  e.observeEvent({ type: 'SessionStart', sessionId: 'new' }, 31 * SEC);
  assert.equal(e.current().actionId, 'waking');
});

test('没睡着时 SessionStart 正常播 launching', () => {
  const e = engine();
  e.observeEvent({ type: 'SessionStart', sessionId: 's' }, SEC);
  assert.equal(e.current().actionId, 'launching');
});

test('waiting 必须能赢得仲裁——此前它从未能显示', () => {
  // 它不在 PRIORITY 表里时会取默认 idle(8)，而仲裁会把 >= idle 的全部过滤掉
  const e = engine();
  e.observeEvent({ type: 'TeammateIdle', sessionId: 's' }, SEC);
  assert.equal(e.current().actionId, 'waiting');
});

test('waiting 压过工作修饰，但让位于要人决定', () => {
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Read' }, SEC);
  e.observeEvent({ type: 'TeammateIdle', sessionId: 'b' }, 2 * SEC);
  assert.equal(e.current().actionId, 'waiting', 'agent 在等外部信号时显示「正在读文件」是错的');
  e.observeEvent({ type: 'PermissionRequest', sessionId: 'a' }, 3 * SEC);
  assert.equal(e.current().actionId, 'needs_owner');
});

// ---------- 体力与 idle 权重 ----------

test('energyFrom 用个人基线，无基线时满体力', () => {
  assert.equal(energyFrom(0, 1000), 1);
  assert.equal(energyFrom(500, 1000), 0.5);
  assert.equal(energyFrom(2000, 1000), 0, '超过基线封底到 0');
  assert.equal(energyFrom(999, null), 1, '没有基线不能判定疲劳');
  assert.equal(energyFrom(999, 0), 1);
});

test('体力低时 drowsy 权重显著上升，Quiet Watch 下降', () => {
  const rested = Object.fromEntries(idleWeights(1));
  const tired = Object.fromEntries(idleWeights(0));
  assert.ok(tired['idle.drowsy'] > rested['idle.drowsy'] * 3);
  assert.ok(tired.idle < rested.idle);
  // 梳毛与蹭腿不受体力影响
  assert.equal(tired['idle.grooming'], rested['idle.grooming']);
});

test('pickWeighted 按权重落点，且权重全零时不崩', () => {
  const weights = [['a', 1], ['b', 0]];
  assert.equal(pickWeighted(weights, fixed(0.1)), 'a');
  assert.equal(pickWeighted([['x', 0]], fixed(0.5)), 'x');
});

test('关闭体力影响后 energy 恒为 1', () => {
  const e = engine({ awayMs: 100 * SEC });
  e.setEnergy(0.2);
  const tired = e.debug().awayThresholdMs;
  e.setEnergy(1);
  assert.ok(e.debug().awayThresholdMs > tired);
});

// ---------- 编排器 ----------

const ACTIONS = [
  { id: 'idle', name: 'Quiet Watch', source: 'src/animations/calm-calibration.svg', durationMs: 5600, mode: 'loop', exit: 'event-driven' },
  { id: 'working', name: 'Tile Stack', source: 'src/animations/token-knitting.svg', durationMs: 3400, mode: 'loop', exit: 'event-driven' },
  { id: 'success', name: 'Self High-five', source: 'src/animations/self-high-five.svg', durationMs: 2900, mode: 'oneshot', exit: 'idle' },
  { id: 'delegating', name: 'Parcel Stack', source: 'src/animations/hatchling-parade.svg', durationMs: 5000, mode: 'loop', variants: ['one-subagent', 'two-or-more-subagents'] },
];

test('fallbackChain 逐级去掉后缀并保证 idle 兜底', () => {
  assert.deepEqual(fallbackChain('working.reading'), ['working.reading', 'working', 'idle']);
  assert.deepEqual(fallbackChain('idle'), ['idle']);
  assert.deepEqual(fallbackChain('unknown'), ['unknown', 'idle']);
});

test('没有独立 SVG 的修饰回落到通用动作，而不是白屏', () => {
  const o = createOrchestrator({ actions: ACTIONS });
  const plan = o.plan('working.reading');
  assert.equal(plan.actionId, 'working');
  assert.equal(plan.fellBackFrom, 'working.reading');
  assert.equal(plan.source, 'src/animations/token-knitting.svg');
});

test('完全未知的状态最终回落 idle', () => {
  const o = createOrchestrator({ actions: ACTIONS });
  assert.equal(o.plan('完全不存在的状态').actionId, 'idle');
});

test('一次性动作带 next，循环动作不带', () => {
  const o = createOrchestrator({ actions: ACTIONS });
  assert.equal(o.plan('success').mode, 'oneshot');
  assert.equal(o.plan('success').next, 'idle');
  assert.equal(o.plan('working').mode, 'loop');
  assert.equal(o.plan('working').next, null);
});

test('只接受契约里声明过的变体', () => {
  const o = createOrchestrator({ actions: ACTIONS });
  assert.equal(o.plan('delegating', { variant: 'two-or-more-subagents' }).variant, 'two-or-more-subagents');
  assert.equal(o.plan('delegating', { variant: '瞎写的变体' }).variant, null);
});

test('减弱动效只关运动，不改契约锁定的时长', () => {
  const o = createOrchestrator({ actions: ACTIONS, reducedMotion: true });
  const plan = o.plan('working');
  assert.equal(plan.motion, false);
  assert.equal(plan.durationMs, 3400, 'durationMs 是契约锁定值，不得因减弱动效改变');
});

test('契约里的 mapsTo 别名优先于回落链', () => {
  // ambient.power_connected 刻意复用 waking（Morning Stretch）：
  // 「能量回来了」本身就读得懂，不需要再加充电器道具。
  // 忽略 mapsTo 的话它会一路回落到 idle，别名等于没生效。
  const o = createOrchestrator({
    actions: [
      ...ACTIONS,
      { id: 'waking', name: 'Morning Stretch', source: 'src/animations/blanket-pop.svg', durationMs: 2600, mode: 'oneshot', exit: 'idle' },
      { id: 'ambient.power_connected', mapsTo: 'waking', source: 'src/animations/blanket-pop.svg' },
    ],
  });
  const plan = o.plan('ambient.power_connected');
  assert.equal(plan.actionId, 'waking');
  assert.equal(plan.name, 'Morning Stretch');
  assert.equal(plan.aliasedFrom, 'ambient.power_connected');
  assert.equal(plan.fellBackFrom, null, '别名不是回落，两者必须分开报告');
});

test('别名指向不存在的动作时仍走回落链', () => {
  const o = createOrchestrator({
    actions: [...ACTIONS, { id: 'x.alias', mapsTo: '并不存在', source: 'src/animations/a.svg' }],
  });
  assert.equal(o.plan('x.alias').actionId, 'x.alias');
});

test('没有任何动作时 plan 返回 null 而不是抛错', () => {
  assert.equal(createOrchestrator({ actions: [] }).plan('idle'), null);
});


// ---------- 最小驻留 ----------

test('同级状态在驻留期内不被顶掉——否则修饰只闪一下人眼看不到', () => {
  const e = createStateEngine({ random: fixed(0.999), minDwellMs: 1200 });
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, 1000);
  assert.equal(e.current().actionId, 'working.reading');
  // 200ms 后换工具：同优先级，驻留期未满，保持不变
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Edit' }, 1200);
  assert.equal(e.current().actionId, 'working.reading');
  // 驻留期满后才切换
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Edit' }, 3000);
  assert.equal(e.current().actionId, 'working.writing');
});

test('更高优先级永远可以立刻抢占，不受驻留限制', () => {
  const e = createStateEngine({ random: fixed(0.999), minDwellMs: 5000 });
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, 1000);
  // 要人决定必须立刻可见——让用户多等 5 秒才知道卡住了是不可接受的
  e.observeEvent({ type: 'PermissionRequest', sessionId: 's' }, 1100);
  assert.equal(e.current().actionId, 'needs_owner');
});

test('一次性插播不受驻留限制', () => {
  const e = createStateEngine({ random: fixed(0.999), minDwellMs: 5000 });
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, 1000);
  e.observeEvent({ type: 'Stop', sessionId: 's' }, 1100);
  assert.equal(e.current().actionId, 'success');
});

test('PostToolUse 保留当前工作修饰，而不是重置回通用', () => {
  // 工具往往几百毫秒就结束，重置回通用会让 5 个修饰动作等于白画
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, 1000);
  e.observeEvent({ type: 'PostToolUse', sessionId: 's' }, 1200);
  assert.equal(e.current().actionId, 'working.reading');
});

test('PostToolUse 在非工作态时才回到通用 working', () => {
  const e = engine();
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, 1000);
  assert.equal(e.current().actionId, 'thinking');
  e.observeEvent({ type: 'PostToolUse', sessionId: 's' }, 2000);
  assert.equal(e.current().actionId, 'working');
});
