import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateEngine } from '../src/runtime/state-engine.js';
import { createOrchestrator } from '../src/runtime/orchestrator.js';
import { loadActions, loadConvergence } from '../src/runtime/server.js';

/**
 * 可达性：**契约里声明的每个动作，都必须有一条能让它真正上屏的路径。**
 *
 * 这条不变量已经被违反过三次，每次的表现都一样——动作画好了、素材在、
 * 契约里列着，但用户永远看不到它，而且**没有任何东西会报错**：
 *
 *   1. `waiting`（Claw Tap Wait）不在 PRIORITY 表里，仲裁取默认值 idle(8)，
 *      而 resolve() 会把 >= idle 的状态全部过滤掉。
 *   2. `waking`（Morning Stretch）压根没有触发源，
 *      away → sleeping → waking 的故事断在中间。
 *   3. `interaction.drag` 等全部外壳动作：resolve() 用 SHELL_PRIORITY 判它们赢，
 *      emit() 却按 actionId 反查 PRIORITY 表、查不到、按 idle 处理，
 *      于是被驻留中的 thinking 挡住——仲裁判赢了却上不了屏。
 *
 * 前两次都是靠人逐个手查发现的。这个测试把它变成机器的事：
 * 每个动作配一段驱动脚本，断言引擎真的会产出它。
 * 新增动作时如果忘了接触发源，这里会直接失败而不是静默沉默。
 */

const SEC = 1000;
const fixed = (value) => () => value;
/** 映射类断言默认关掉驻留：这里验的是「能不能到达」，不是时序。 */
const engine = (options = {}) => createStateEngine({ random: fixed(0.999), minDwellMs: 0, ...options });

/**
 * 把引擎推进到静默态（away / sleeping）。
 *
 * 必须发完整的一轮「提问 → 收尾」：Stop 会把会话状态设回 idle，
 * 而静默清理只收 idle 级的会话。只发 UserPromptSubmit 就干等的话，
 * 会话会一直停在 thinking(7) 上永不过期——那是**不真实的用法**，
 * 用它来测会把测试写成描述 bug 而不是描述需求。
 */
function idleFor(ms, options = {}) {
  const e = engine(options);
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, SEC);
  e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'complete' }, 2 * SEC);
  return e.tick(2 * SEC + ms);
}

/**
 * 每个动作 → 一段能产出它的驱动脚本。
 *
 * 刻意**写成显式的场景**而不是「反查引擎里有没有这个字符串」：
 * 字符串出现在源码里不等于那条路径走得通——上面三次事故全都是
 * 「字符串在、路径不通」。只有真的驱动一遍引擎才算数。
 */
const SCENARIOS = {
  idle: () => engine().tick(SEC).actionId,

  // 三个 idle 变体走权重轮换，用固定随机源点名
  'idle.grooming': () => {
    const e = createStateEngine({ random: fixed(0.7), minDwellMs: 0 });
    return e.tick(60 * SEC).actionId;
  },
  'idle.leg_shuffle': () => {
    const e = createStateEngine({ random: fixed(0.85), minDwellMs: 0 });
    return e.tick(60 * SEC).actionId;
  },
  'idle.drowsy': () => {
    const e = createStateEngine({ random: fixed(0.98), minDwellMs: 0 });
    return e.tick(60 * SEC).actionId;
  },

  away: () => idleFor(6 * 60 * SEC).actionId,
  sleeping: () => idleFor(8 * 60 * SEC).actionId,

  // 睡着之后来任何事件都要先伸个懒腰。这条曾经完全断掉。
  waking: () => {
    const e = engine();
    e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, SEC);
    e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'complete' }, 2 * SEC);
    e.tick(9 * 60 * SEC);
    e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, 9 * 60 * SEC + SEC);
    return e.current().actionId;
  },

  thinking: () => {
    const e = engine();
    e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  working: () => {
    const e = engine();
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: '某个新工具' }, SEC);
    return e.current().actionId;
  },
  'working.building': () => {
    const e = engine();
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm run build' }, SEC);
    return e.current().actionId;
  },
  'working.testing': () => {
    const e = engine();
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Bash', command: 'npm test' }, SEC);
    return e.current().actionId;
  },
  // 工具失败后转入重试态：不是整轮失败（那是 error），也不能退回通用 working
  'working.retrying': () => {
    const e = engine();
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: 'Read' }, SEC);
    e.observeEvent({ type: 'PostToolUseFailure', sessionId: 's' }, 2 * SEC);
    return e.current().actionId;
  },
  // 「久战」不是事件驱动的，是**同一个通用 working 持续够久**才升级。
  // 所以场景必须真的把时间推过门槛，不能靠发某个事件。
  'working.long': () => {
    const e = engine();
    e.observeEvent({ type: 'PreToolUse', sessionId: 's', toolName: '某个新工具' }, SEC);
    return e.tick(SEC + 4 * 60 * SEC).actionId;
  },
  delegating: () => {
    const e = engine();
    e.observeEvent({ type: 'SubagentStart', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  compacting: () => {
    const e = engine();
    e.observeEvent({ type: 'PreCompact', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  needs_owner: () => {
    const e = engine();
    e.observeEvent({ type: 'PermissionRequest', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  waiting: () => {
    const e = engine();
    e.observeEvent({ type: 'TeammateIdle', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  // PostToolUseFailure 刻意**不**升级到 error（那是单个工具失败，不是整轮失败），
  // 只有 StopFailure 才是。这个区分写在引擎的注释里，很容易看漏。
  error: () => {
    const e = engine();
    e.observeEvent({ type: 'StopFailure', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  success: () => {
    const e = engine();
    e.observeEvent({ type: 'Stop', sessionId: 's', disposition: 'complete' }, SEC);
    return e.current().actionId;
  },
  owner_resolved: () => {
    const e = engine();
    e.observeEvent({ type: 'PermissionRequest', sessionId: 's' }, SEC);
    e.observeEvent({ type: 'PermissionResolved', sessionId: 's' }, 2 * SEC);
    return e.current().actionId;
  },
  recovering: () => {
    const e = engine();
    e.observeEvent({ type: 'StopFailure', sessionId: 's' }, SEC);
    e.observeEvent({ type: 'ErrorResolved', sessionId: 's' }, 2 * SEC);
    return e.current().actionId;
  },
  launching: () => {
    const e = engine();
    e.observeEvent({ type: 'SessionStart', sessionId: 's' }, SEC);
    return e.current().actionId;
  },
  quitting: () => {
    const e = engine();
    e.observeEvent({ type: 'SessionEnd', sessionId: 's' }, SEC);
    return e.current().actionId;
  },

  // 外壳事件。第三次事故就出在这一整组——它们全都不在 PRIORITY 表里。
  paused: () => shell('shell.paused'),
  'interaction.click': () => shell('shell.click'),
  'interaction.double_click': () => shell('shell.doubleClick'),
  'interaction.drag': () => shell('shell.dragStart'),
  'interaction.drop': () => shell('shell.drop'),
  'interaction.hover': () => shell('shell.hover'),
  'ambient.edge': () => shell('shell.screenEdge'),
  'ambient.low_battery': () => shell('shell.lowBattery'),
  'ambient.offline': () => shell('shell.offline'),
  'ambient.power_connected': () => shell('shell.powerConnected'),
};

/**
 * 外壳事件的驱动：**先让引擎处在一个非 idle 的状态**再发事件。
 *
 * 从空引擎发外壳事件是过不了关的测法——那样即使 emit() 把它当成
 * idle 级也能过，正好漏掉第三次事故的全部内容。必须先有一个
 * 驻留中的 thinking 压着，才能验出「外壳动作能不能抢占」。
 */
function shell(type) {
  const e = createStateEngine({ random: fixed(0.999), minDwellMs: 1200 });
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 's' }, SEC);
  e.observeEvent({ type }, SEC + 200);
  return e.current().actionId;
}

const actions = loadActions().filter((a) => a.group !== 'mini');

test('每个契约动作都配了驱动脚本——新增动作不许漏接触发源', () => {
  const missing = actions.map((a) => a.id).filter((id) => !SCENARIOS[id]);
  assert.deepEqual(missing, [],
    `这些动作没有可达性场景，等于没人验证过它们能不能上屏：${missing.join(', ')}`);

  // 反向也要查：场景表里不该留已经退役的动作
  const known = new Set(actions.map((a) => a.id));
  const stale = Object.keys(SCENARIOS).filter((id) => !known.has(id));
  assert.deepEqual(stale, [], `场景表里有契约已删除的动作：${stale.join(', ')}`);
});

test('每个契约动作都真的能被引擎产出', () => {
  const unreachable = [];
  for (const action of actions) {
    let got;
    try {
      got = SCENARIOS[action.id]();
    } catch (error) {
      unreachable.push(`${action.id}（场景抛错：${error.message}）`);
      continue;
    }
    if (got !== action.id) unreachable.push(`${action.id} → 实际产出 ${got}`);
  }
  assert.deepEqual(unreachable, [],
    `这些动作画好了、契约里列着，但用户永远看不到：\n  ${unreachable.join('\n  ')}`);
});

test('产出的动作都能选出自己的素材，不许静默回落', () => {
  // 可达只是第一关：引擎产出了 id，编排器还得能找到对应素材。
  // 找不到时它会沿回落链降级——那同样是「动作从没出现过」，只是原因在另一头。
  // `ambient.power_connected` 是唯一允许的例外：它是契约里明确的别名。
  const orchestrator = createOrchestrator({
    actions: loadActions(),
    convergence: loadConvergence(),
  });
  const degraded = [];
  for (const action of actions) {
    const plan = orchestrator.plan(action.id);
    if (!plan) { degraded.push(`${action.id}（没有计划）`); continue; }
    if (plan.aliasedFrom) continue; // 契约指定的别名复用
    if (plan.actionId !== action.id) {
      degraded.push(`${action.id} → 回落到 ${plan.actionId}`);
    }
  }
  assert.deepEqual(degraded, [], `这些动作被静默降级了：${degraded.join(', ')}`);
});

// ---------- 并发分档 ----------

test('分档按并发会话数换素材，但状态 id 始终不变', () => {
  // tier 是**渲染层**的机制：多开几个窗口，画面该变，但状态机不该多出一档。
  // 一旦有人把它做成新状态，优先级表和收敛表都要跟着改，那就走错路了。
  const orchestrator = createOrchestrator({ actions: loadActions() });
  const seen = new Set();
  for (const busy of [1, 2, 3, 9]) {
    const plan = orchestrator.plan('working', { busy });
    assert.equal(plan.actionId, 'working', `并发 ${busy} 时状态 id 变了`);
    seen.add(plan.source);
  }
  assert.equal(seen.size, 3, `1/2/3 档应该是三份不同素材，实际 ${seen.size} 份`);
});

test('并发计数只数真实会话，合成会话不算', () => {
  // `rate`（速率推断兜底）与 `shell`（外壳交互）不是真实的 agent 会话。
  // 把它们算进去，用户只开一个窗口也会看到「三条流水线」。
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'x' }, SEC);
  assert.equal(e.current().busy, 1);
  e.observeRate(9999, 2 * SEC);
  assert.equal(e.current().busy, 1, '速率兜底被计入了并发');
  e.observeEvent({ type: 'shell.hover' }, 3 * SEC);
  assert.equal(e.current().busy, 1, '外壳会话被计入了并发');
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 'b' }, 4 * SEC);
  assert.equal(e.current().busy, 2, '第二个真实会话没被计入');
});

test('并发数必须实时算，不能在状态变化时冻结', () => {
  // emit() 只在**动作变化**时触发，而多开一个窗口并不改变赢家
  // （working 压过 thinking）。冻结在 emit 里的话，并发数会一直是旧的。
  const e = engine();
  e.observeEvent({ type: 'PreToolUse', sessionId: 'a', toolName: 'x' }, SEC);
  const before = e.current().actionId;
  e.observeEvent({ type: 'UserPromptSubmit', sessionId: 'b' }, 2 * SEC);
  assert.equal(e.current().actionId, before, '前提：动作不该变');
  assert.equal(e.current().busy, 2, '动作没变时并发数也必须更新');
});

test('占位素材必须被标出来，不能悄悄变成成品', () => {
  // 分档的动作设计还没定，现在用的是占位。契约里标了 placeholder，
  // 计划里也要透出来——不标的话，占位会在某次「看起来能用」之后
  // 默默留下来，没人记得它本来是临时的。
  const orchestrator = createOrchestrator({ actions: loadActions() });
  assert.equal(orchestrator.plan('working', { busy: 1 }).tier.placeholder, false);
  for (const busy of [2, 3]) {
    assert.equal(orchestrator.plan('working', { busy }).tier.placeholder, true,
      `第 ${busy} 档没有标成占位`);
  }
});
