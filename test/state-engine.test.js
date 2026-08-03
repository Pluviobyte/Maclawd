import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBash, createStateEngine, energyFrom, idleWeights, ONESHOT, pickWeighted,
  PRIORITY, SHELL_ACTIONS,
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
  assert.ok(PRIORITY.delegating < PRIORITY['working.testing']);
  assert.ok(PRIORITY['working.testing'] < PRIORITY.working);
  assert.ok(PRIORITY.working < PRIORITY.thinking);
  assert.ok(PRIORITY.thinking < PRIORITY.idle);
});

test('多会话取优先级最高的那个', () => {
  const e = engine();
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 'a' }, 1 * SEC);
  e.observeEvent({ type: 'PreToolUse', sessionId: 'b', toolName: 'Bash', command: 'npm test' }, 2 * SEC);
  assert.equal(e.current().actionId, 'working.testing', 'b 的工作修饰压过 a 的 thinking');

  // a 卡住等人 → 立刻抢占
  e.observeEvent({ type: 'PermissionRequest', sessionId: 'a' }, 3 * SEC);
  assert.equal(e.current().actionId, 'needs_owner');
  assert.equal(e.current().sessionId, 'a');
});

test('同优先级取最近事件的会话', () => {
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'Bash', command: 'npm run build' }, 1 * SEC);
  e.observeEvent({ type: 'PreToolUse', sessionId: 'b', toolName: 'Bash', command: 'npm test' }, 2 * SEC);
  assert.equal(e.current().sessionId, 'b');
  assert.equal(e.current().actionId, 'working.testing');
});

test('会话静默后退出活跃集，不会永远占着状态', () => {
  const e = engine({ sessionIdleMs: 10 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 'a' }, 1 * SEC);
  e.tick(5 * SEC);
  e.tick(60 * SEC);
  assert.ok(e.debug().sessions.length === 0, '静默会话应被清理');
});

// ---------- 工具名 → 修饰 ----------

test('毫秒级工具不再升级修饰，统一回落通用 working', () => {
  // TOOL_MODIFIERS 现在刻意留空。Read/Grep/Edit/WebFetch 几毫秒就返回，
  // 修饰在屏幕上一闪而过，真机试跑时根本看不见——为看不见的东西
  // 各画一套动作是白费。判据是能不能被看见，不是好不好看。
  const e = engine();
  let t = 0;
  for (const tool of ['Read', 'Grep', 'Edit', 'WebFetch', 'NotebookRead']) {
    t += SEC;
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: tool }, t);
    assert.equal(e.current().actionId, 'working', tool);
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
  // 同步类已退役：git/curl 与通用 working 无实质信息差
  assert.equal(classifyBash('git push origin main'), 'working');
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

test('CwdChanged 不再插播 workspace，只进入 working', () => {
  // 切工作目录是低信息事件，而 oneshot 插播会打断真正在演的动作。
  const e = engine();
  e.observeEvent({ type: 'CwdChanged', sessionId: 's' }, SEC);
  assert.equal(e.current().actionId, 'working');
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
  // 静默时钟从**没东西可显示的那一刻**起算，不是从最后一次事件。
  // Stop 让会话回到 idle 级（会被仲裁过滤掉），同时插播 3 秒的 success；
  // 插播结束、仲裁再也选不出赢家时，才算真正安静下来。
  //
  // 旧版按「最后一次事件」起算，与「会话还在不在」这个闸门对不上，
  // 后果是 away 在真实使用中一次都没上过屏（活跃会话拖过了 away 窗口，
  // 等它过期时 silent 早已越过 sleeping 线）。
  const e = engine({ awayMs: 10 * SEC, sleepMs: 5 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  e.tick(5 * SEC);   // 插播刚结束，静默时钟从这里起算
  assert.notEqual(e.current().actionId, 'away', '刚安静下来还不该离开');
  e.tick(14 * SEC);
  assert.notEqual(e.current().actionId, 'away', '静默 9s，还不到阈值');
  e.tick(16 * SEC);
  assert.equal(e.current().actionId, 'away', '静默 11s 进入 away');
  e.tick(21 * SEC);
  assert.equal(e.current().actionId, 'sleeping', '静默 16s 已经睡着');
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
  e.tick(5 * SEC);   // 插播结束，静默时钟起算
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
  e.tick(5 * SEC);
  e.tick(30 * SEC);
  e.observeRate(90_000, 31 * SEC);
  assert.equal(e.current().actionId, 'waking');
});

test('刚醒来时不叠加 launching，两个开场动作不打架', () => {
  const e = engine({ awayMs: 10 * SEC, sleepMs: 5 * SEC });
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  e.tick(5 * SEC);
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
  const bash = (command, at) => e.observeEvent(
    { type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command }, at,
  );
  bash('npm run build', 1000);
  assert.equal(e.current().actionId, 'working.building');
  // 200ms 后换命令：同优先级，驻留期未满，保持不变
  bash('npm test', 1200);
  assert.equal(e.current().actionId, 'working.building');
  // 驻留期满后才切换
  bash('npm test', 3000);
  assert.equal(e.current().actionId, 'working.testing');
});

test('更高优先级永远可以立刻抢占，不受驻留限制', () => {
  const e = createStateEngine({ random: fixed(0.999), minDwellMs: 5000 });
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm test' }, 1000);
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
  // Bash 命令往往跑几十秒，但 PostToolUse 一到就重置回通用的话，
  // 保留下来的两个修饰同样等于白画
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm test' }, 1000);
  e.observeEvent({ type: 'PostToolUse', sessionId: 's' }, 1200);
  assert.equal(e.current().actionId, 'working.testing');
});

test('PostToolUse 在非工作态时才回到通用 working', () => {
  const e = engine();
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, 1000);
  assert.equal(e.current().actionId, 'thinking');
  e.observeEvent({ type: 'PostToolUse', sessionId: 's' }, 2000);
  assert.equal(e.current().actionId, 'working');
});

// ---------- Stop 判定：不在用户打断时欢呼 ----------

test('只有确认自然收尾才庆祝', () => {
  const e = engine();
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'complete' }, SEC);
  assert.equal(e.current().actionId, 'success');
});

test('停在工具调用上却收到 Stop —— 多半被打断，安静收场', () => {
  // 用户按 ESC 时 Stop 照样触发。那时候欢呼是会烦人的，
  // 而 Claude Code 没有暴露「取消」信号（stop_details 全为 null），
  // 所以判不出来就什么都不播——宁可少一个动作，不要说错话。
  const e = engine();
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'inconclusive' }, SEC);
  assert.notEqual(e.current().actionId, 'success');
  const e2 = engine();
  e2.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'unknown' }, SEC);
  assert.notEqual(e2.current().actionId, 'success');
});

test('没有 disposition 字段时按老行为庆祝（面板手动触发 / 旧写入器）', () => {
  const e = engine();
  e.observeEvent({ type: 'Stop', sessionId: 's' }, SEC);
  assert.equal(e.current().actionId, 'success');
});

test('PostToolUseFailure 转入重试态，不升级成 error', () => {
  // 一次工具失败不等于整轮失败（那是 StopFailure）。但也不能退回通用 working——
  // 那等于把「刚才那步没成功」丢掉，而 Claude 经常静默重试，
  // 用户只看到它一直在忙，不知道它在原地打转。
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, SEC);
  e.observeEvent({ type: 'PostToolUseFailure', sessionId: 's' }, 2 * SEC);
  assert.equal(e.current().actionId, 'working.retrying');
  assert.notEqual(e.current().actionId, 'error', '单个工具失败不该升级成整轮失败');
});

// ---------- held 模式 ----------

test('hover 是 held：必须成对，否则注视态永远挂着', () => {
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm test' }, SEC);
  e.observeEvent({ type: 'shell.hover' }, 2 * SEC);
  assert.equal(e.current().actionId, 'interaction.hover');
  e.observeEvent({ type: 'shell.hoverEnd' }, 3 * SEC);
  assert.equal(e.current().actionId, 'working.testing', '移开后应回到底下真实的状态');
});

test('落地必须清掉拖拽的持有态，否则桌宠卡在吊环上出不来', () => {
  // interaction.drag 是 held（拖拽期间一直挂着），interaction.drop 是 oneshot。
  // 两者走引擎里不同的分支，所以 drop 很容易忘记去清 drag——
  // 一旦忘了，Drop Wobble 播完会掉回 drag，而 shell 优先级 4.3
  // 压过 working(6) 和 thinking(7)，表现是「拖完之后桌宠就不动了」。
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm test' }, SEC);
  assert.equal(e.current().actionId, 'working.testing');

  e.observeEvent({ type: 'shell.dragStart' }, 2 * SEC);
  assert.equal(e.current().actionId, 'interaction.drag', '拖拽期间应显示 Hanging Loop');

  e.observeEvent({ type: 'shell.drop' }, 3 * SEC);
  assert.equal(e.current().actionId, 'interaction.drop', '落地先播一次性的 Drop Wobble');

  // 一次性动作播完（引擎里插播时长 3 秒）后必须回到底下真实的状态
  assert.equal(e.tick(7 * SEC).actionId, 'working.testing', '落地后应回到工作态，而不是卡在拖拽姿势');
});

test('外壳交互状态不许被驻留挡住——它们不在 PRIORITY 表里', () => {
  // resolve() 给 shell 会话判的是 SHELL_PRIORITY(4.3)，稳赢 thinking(7)。
  // 但 emit() 曾经按 actionId 反查 PRIORITY 表来决定能不能抢占，
  // 而 interaction.* / ambient.* 一个都不在表里 → 全被当成 idle(8) →
  // 被驻留中的 thinking 挡住，仲裁判赢了却上不了屏。
  // `waiting` 当年就是这么消失的，拖拽是同一个坑的第二次。
  const e = createStateEngine({ random: fixed(0.999), minDwellMs: 1200 });
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, 1000);
  assert.equal(e.current().actionId, 'thinking');

  // 驻留期内（才过 200ms）就拖起来，必须立刻切过去
  e.observeEvent({ type: 'shell.dragStart' }, 1200);
  assert.equal(e.current().actionId, 'interaction.drag',
    '拖拽被最小驻留挡住了——外壳交互必须能立刻抢占');
});

test('每一个外壳事件对应的动作都能真正上屏', () => {
  // 逐个验证，而不是只验一个：SHELL_ACTIONS 里有十几个映射，
  // 它们全都不在 PRIORITY 表里，一个漏网就是一个「画了但从没出现过」的动作。
  const held = Object.entries(SHELL_ACTIONS)
    .filter(([, action]) => !ONESHOT.has(action) && action !== 'idle');
  assert.ok(held.length >= 4, `held 型外壳事件太少：${held.length}`);

  for (const [type, action] of held) {
    const e = createStateEngine({ random: fixed(0.999), minDwellMs: 1200 });
    e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, 1000);
    e.observeEvent({ type }, 1200);
    assert.equal(e.current().actionId, action, `${type} 没能上屏`);
  }
});

test('会话被强杀后不能永远卡在工作态——否则桌宠再也不会睡', () => {
  // Stop / SessionEnd 是正常收尾路径，但 kill -9、关终端、崩溃时它们都不会来。
  // 活跃态如果永不过期，桌宠会一直显示「正在工作」，
  // away → sleeping 这条链就永远走不到——而那是用户明确要保留的。
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm test' }, SEC);
  assert.equal(e.current().actionId, 'working.testing');

  // 五分钟没有事件：长时间跑的测试就是这样，**不该**被收掉
  assert.equal(e.tick(5 * 60 * SEC).actionId, 'working.testing',
    '长时间跑的工具被误收了——它本来就没有中间事件');

  // 十分钟没有任何事件：源头几乎肯定已经断了，必须放行到静默链。
  // 这个兜底原来是 30 分钟——太偏向「保护长时间跑的工具」，
  // 代价是人离开后桌宠还会假装工作半小时。
  const after = e.tick(20 * 60 * SEC);
  assert.notEqual(after.actionId, 'working.testing', '卡死的会话没有被兜底清掉');
  // 清掉之后进入静默链的**第一站**是 idle（含它的三个变体），不是直接睡着。
  // 静默时钟从会话清空那一刻起算，所以要再等满 away 阈值才离开。
  // 旧版从「最后一次事件」起算，这里会直接跳到 sleeping——
  // 那正是实测中 idle 与 away 一次都没上过屏的原因。
  assert.ok(after.actionId.startsWith('idle'),
    `清掉之后应先回到 idle，实际是 ${after.actionId}`);

  // 再等满 away 与 sleeping 的阈值，完整的链才走得完
  assert.equal(e.tick(20 * 60 * SEC + 6 * 60 * SEC).actionId, 'away', '没有进入 away');
  assert.equal(e.tick(20 * 60 * SEC + 8 * 60 * SEC).actionId, 'sleeping', '没有睡着');
});
