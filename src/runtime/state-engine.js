/**
 * 运行时状态引擎。实现 design/token-tracking.md「状态仲裁」与
 * design/token-experience.md 第 2、3 层（强度与体力）。
 *
 * 纯逻辑，不碰 DOM、不碰文件、不碰时钟——`now` 一律由调用方传入。
 * 这样它既能被浏览器驱动，也能被 Swift 外壳驱动，还能在测试里回放事件轨迹。
 */

/** 优先级：数字越小越优先。一台机器可能跑多个会话，但桌宠只有一只。 */
export const PRIORITY = {
  needs_owner: 1,
  error: 2,
  compacting: 3,
  delegating: 4,
  // Claw Tap Wait。此前**从未能显示**：它不在这张表里，仲裁时取默认值
  // PRIORITY.idle(8)，而 resolve() 会把 >= idle 的状态全部过滤掉。
  // 位置在委派之下、工作修饰之上——agent 在等外部信号时，
  // 显示「正在读文件」是错的。
  waiting: 4.6,
  'working.reading': 5,
  'working.writing': 5,
  'working.building': 5,
  'working.testing': 5,
  'working.syncing': 5,
  working: 6,
  thinking: 7,
  idle: 8,
  away: 9,
  sleeping: 10,
};

/** 一次性动作：插播完毕回到当前最高优先级的循环态。 */
export const ONESHOT = new Set([
  'launching', 'quitting', 'success', 'owner_resolved',
  'recovering', 'cancelled', 'workspace', 'waking',
  // 交互与环境反应也是插播：摸一下、吓一跳、落地、注意到通知
  'interaction.click', 'interaction.double_click', 'interaction.drop',
  'interaction.hover', 'ambient.notification', 'ambient.power_connected',
  'ambient.reconnecting', 'moving',
]);

/**
 * 外壳事件 → 动作。
 *
 * 这些**不是** agent 适配器的职责，而是 Mac 应用自己的输入与系统事件
 * （PROGRESS.md 的划分）。外壳里早就有拖拽和点击的代码，但一直没把事件
 * 喂回引擎，导致 Poke Squish、Curtain Peek、Low Battery Droop 这些画好的
 * 动作**从没在屏幕上出现过**。这张表就是那条缺失的回路。
 */
export const SHELL_ACTIONS = {
  'shell.click': 'interaction.click',
  'shell.doubleClick': 'interaction.double_click',
  'shell.dragStart': 'interaction.drag',
  'shell.drop': 'interaction.drop',
  'shell.hover': 'interaction.hover',
  'shell.move': 'moving',
  'shell.screenEdge': 'ambient.edge',
  'shell.lowBattery': 'ambient.low_battery',
  'shell.powerConnected': 'ambient.power_connected',
  'shell.notification': 'ambient.notification',
  'shell.offline': 'ambient.offline',
  'shell.reconnected': 'ambient.reconnecting',
  'shell.paused': 'paused',
  'shell.resumed': 'idle',
};

/**
 * 外壳事件的优先级。介于「委派」与「等待」之间：
 * 用户戳了桌宠一下，那个反馈必须立刻可见，但不该盖过「卡住等你决定」。
 */
const SHELL_PRIORITY = 4.3;

/**
 * 工具名 → 工作修饰。主状态契约要求「详细修饰必须有可靠外部事件」，
 * tool_name 就是那个可靠事件。
 */
export const TOOL_MODIFIERS = {
  Read: 'working.reading',
  Grep: 'working.reading',
  Glob: 'working.reading',
  NotebookRead: 'working.reading',
  Write: 'working.writing',
  Edit: 'working.writing',
  NotebookEdit: 'working.writing',
  WebFetch: 'working.syncing',
  WebSearch: 'working.syncing',
};

/**
 * Bash 命令的三分类是**启发式**，不是可靠事件。按契约精神，只有高置信度模式
 * 才升级到具体修饰，否则老实回落通用 Tile Stack。
 *
 * command 字符串只用于这里的正则判断，绝不落盘（token-tracking.md 原则 2）。
 */
const BASH_PATTERNS = [
  [/\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|jest|vitest)\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b/, 'working.testing'],
  [/\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?build\b|\bmake\b|\bcargo\s+build\b|\bgo\s+build\b|\btsc\b|\bwebpack\b|\bvite\s+build\b/, 'working.building'],
  [/\bgit\s+(?:push|pull|fetch|clone)\b|\b(?:curl|wget|rsync|scp)\b|\bdocker\s+push\b/, 'working.syncing'],
];

export function classifyBash(command) {
  if (typeof command !== 'string' || !command) return 'working';
  for (const [pattern, action] of BASH_PATTERNS) {
    if (pattern.test(command)) return action;
  }
  return 'working';
}

/** idle 变体的基础权重。energy 低时把权重推向 drowsy。 */
const IDLE_VARIANTS = [
  ['idle', 62],
  ['idle.grooming', 14],
  ['idle.leg_shuffle', 14],
  ['idle.drowsy', 10],
];

export function idleWeights(energy = 1) {
  // energy 1 → 原始权重；energy 0 → drowsy 权重大幅上升，安静观察下降
  const tired = 1 - Math.max(0, Math.min(1, energy));
  return IDLE_VARIANTS.map(([id, base]) => {
    if (id === 'idle') return [id, base * (1 - 0.55 * tired)];
    if (id === 'idle.drowsy') return [id, base * (1 + 5 * tired)];
    return [id, base];
  });
}

/** 用可注入的随机源，让测试可以确定性地断言权重效果。 */
export function pickWeighted(weights, random = Math.random) {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return weights[0]?.[0] ?? 'idle';
  let roll = random() * total;
  for (const [id, w] of weights) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return weights.at(-1)[0];
}

const DEFAULTS = {
  // 会话静默多久后退出活跃集
  sessionIdleMs: 90_000,
  // 全部会话静默多久后进入 away（energy 低时缩短）
  awayMs: 5 * 60_000,
  // away 之后多久睡着
  sleepMs: 60_000,
  // 无 hook 时，token 速率高于此值判定为 working
  workingRateThreshold: 200,
  // idle 变体轮换间隔
  idleVariantMs: 45_000,
  // 最小驻留时长。动作契约给每个动作锁了 durationMs，如果状态切得比这还快，
  // 用户永远看不完一个完整循环。低优先级状态要等驻留期满才能顶掉当前状态；
  // 高优先级（要人决定、出错）永远可以立刻抢占。
  minDwellMs: 1_200,
};

/**
 * @param {object} options
 * @param {(state) => void} [options.onChange] 状态变化回调
 */
export function createStateEngine(options = {}) {
  const config = { ...DEFAULTS, ...options };
  /** sessionId → { state, variant, at, subagents:Set, pendingPermission:boolean } */
  const sessions = new Map();
  let energy = 1;
  let rate = 0;
  let oneshot = null;          // { id, until }
  let current = { actionId: 'idle', variant: null, sessionId: null, since: 0, reason: 'init' };
  let idleVariant = 'idle';
  let idleVariantAt = 0;
  let lastActivityAt = 0;
  const random = options.random ?? Math.random;

  const session = (id) => {
    let s = sessions.get(id);
    if (!s) {
      s = { state: 'idle', variant: null, at: 0, subagents: new Set(), pendingPermission: false };
      sessions.set(id, s);
    }
    return s;
  };

  function emit(next, reason, now) {
    if (next.actionId === current.actionId && next.variant === current.variant) return;

    // 最小驻留：优先级不高于当前的状态，要等驻留期满才能替换。
    // 一次性插播与更高优先级的状态不受限制——要人决定、出错必须立刻可见。
    const incoming = PRIORITY[next.actionId] ?? PRIORITY.idle;
    const holding = PRIORITY[current.actionId] ?? PRIORITY.idle;
    const elapsed = now - current.since;
    if (
      reason !== 'oneshot'
      && current.reason !== 'init'
      && incoming >= holding
      && elapsed < config.minDwellMs
    ) return;

    current = { ...next, since: now, reason };
    options.onChange?.(current);
  }

  /**
   * Hook 事件 → 会话状态。事件名沿用 Claude Code 的 hook 名称，
   * 映射表见 design/token-tracking.md。
   */
  /**
   * 从 away / sleeping 被唤醒时插播 Morning Stretch。
   *
   * 此前 `waking` **没有任何触发源**：引擎从 sleeping 直接跳到 working，
   * 把契约里 `away → sleeping → waking → idle` 那条共用同一条毛毯的
   * 连续故事切断了——三个动作里有一个永远看不到。
   */
  function wakeIfAsleep(now) {
    if (current.actionId === 'sleeping' || current.actionId === 'away') {
      pushOneshot('waking', now);
      return true;
    }
    return false;
  }

  function observeEvent(event, now = 0) {
    const { type, sessionId = 'default' } = event ?? {};
    if (!type) return;

    // 外壳事件走单独一条路：它们不属于任何 agent 会话。
    const shellAction = SHELL_ACTIONS[type];
    if (shellAction) {
      lastActivityAt = now;
      if (ONESHOT.has(shellAction)) {
        pushOneshot(shellAction, now);
      } else {
        const s = session('shell');
        s.state = shellAction;
        s.at = now;
        // 持续态（拖拽中、贴边、低电量、暂停）要能被主动清除
        if (type === 'shell.resumed') sessions.delete('shell');
      }
      resolve(now);
      return;
    }

    const s = session(sessionId);
    s.at = now;
    // 先判断再更新时间戳：wakeIfAsleep 要看的是「醒来之前」的状态
    const wasAsleep = wakeIfAsleep(now);
    lastActivityAt = now;

    switch (type) {
      case 'SessionStart':
        s.state = 'thinking';
        // 刚被唤醒时优先播 Morning Stretch，那是睡眠链的收尾；
        // 再叠一个 Hello Unfold 会让两个开场动作打架。
        if (!wasAsleep) pushOneshot('launching', now);
        break;
      case 'UserPromptSubmit':
        s.state = 'thinking';
        s.pendingPermission = false;
        break;
      case 'PreToolUse': {
        const tool = event.toolName;
        if (tool === 'Bash') {
          // hook 写入器在它自己的进程里就地分类，命令原文根本不过边界；
          // 这里优先采纳它的结果，只有面板手动触发才会带 command 过来。
          s.state = event.commandClass ?? classifyBash(event.command);
        } else {
          s.state = TOOL_MODIFIERS[tool] ?? 'working';
        }
        break;
      }
      case 'PostToolUse':
      case 'PostToolBatch':
        // 不要重置回通用 working。
        //
        // 实测发现的问题：工具往往几百毫秒就结束，PostToolUse 紧跟 PreToolUse 到达，
        // 于是「正在读文件 / 正在同步」这些具体修饰只闪一下就没了，
        // 人眼根本看不到——等于 5 个工作修饰动作白画。
        // 保留当前修饰，让它自然被下一个 PreToolUse 替换。
        if (!String(s.state).startsWith('working')) s.state = 'working';
        break;
      case 'SubagentStart':
        if (event.agentId) s.subagents.add(event.agentId);
        s.state = 'delegating';
        s.variant = s.subagents.size >= 2 ? 'two-or-more-subagents' : 'one-subagent';
        break;
      case 'SubagentStop':
        if (event.agentId) s.subagents.delete(event.agentId);
        if (s.subagents.size === 0) s.state = 'working';
        else s.variant = s.subagents.size >= 2 ? 'two-or-more-subagents' : 'one-subagent';
        break;
      case 'PreCompact':
        s.state = 'compacting';
        break;
      case 'PostCompact':
        s.state = 'working';
        break;
      case 'PermissionRequest':
        s.state = 'needs_owner';
        s.variant = 'permission';
        s.pendingPermission = true;
        break;
      case 'Notification':
        if (event.matcher === 'permission_prompt') {
          s.state = 'needs_owner';
          s.variant = 'permission';
          s.pendingPermission = true;
        } else if (event.matcher === 'idle_prompt') {
          s.state = 'needs_owner';
          s.variant = 'question';
        }
        break;
      case 'PermissionResolved':
        if (s.pendingPermission) {
          s.pendingPermission = false;
          pushOneshot('owner_resolved', now);
        }
        s.state = 'working';
        break;
      case 'CwdChanged':
        pushOneshot('workspace', now);
        s.state = 'working';
        break;
      case 'TeammateIdle':
        s.state = 'waiting';
        break;
      case 'Stop':
        s.state = 'idle';
        s.variant = null;
        pushOneshot('success', now);
        break;
      case 'StopFailure':
        s.state = 'error';
        s.variant = event.matcher ?? null;
        break;
      case 'ErrorResolved':
        s.state = 'idle';
        pushOneshot('recovering', now);
        break;
      case 'SessionEnd':
        sessions.delete(sessionId);
        pushOneshot('quitting', now);
        break;
      default:
        break;
    }
    resolve(now);
  }

  function pushOneshot(id, now) {
    oneshot = { id, until: now + 3000 };
  }

  /** 无 hook 时的降级路径：只能从 token 速率区分 working / idle。 */
  function observeRate(tokensPerMin, now = 0) {
    rate = Number.isFinite(tokensPerMin) ? tokensPerMin : 0;
    if (rate >= config.workingRateThreshold) {
      wakeIfAsleep(now);
      lastActivityAt = now;
      const s = session('rate');
      // 速率推断只敢下「通用忙碌」，绝不臆造具体任务——契约要求可靠事件才细分。
      if (PRIORITY[s.state] === undefined || PRIORITY[s.state] > PRIORITY.working) {
        s.state = 'working';
      }
      s.at = now;
    } else {
      const s = sessions.get('rate');
      if (s && s.state === 'working') s.state = 'idle';
    }
    resolve(now);
  }

  function setEnergy(value) {
    energy = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  }

  /** energy 越低，away 阈值越短——累了就更早去睡。 */
  function awayThreshold() {
    return config.awayMs * (0.35 + 0.65 * energy);
  }

  function resolve(now) {
    // 一次性动作插播期间不切换
    if (oneshot) {
      if (now < oneshot.until) {
        emit({ actionId: oneshot.id, variant: null, sessionId: null }, 'oneshot', now);
        return current;
      }
      oneshot = null;
    }

    // 清理静默会话
    for (const [id, s] of sessions) {
      if (now - s.at > config.sessionIdleMs && PRIORITY[s.state] >= PRIORITY.idle) {
        sessions.delete(id);
      }
    }

    // 取所有活跃会话里优先级最高的；同级取最近
    let best = null;
    for (const [id, s] of sessions) {
      const priority = id === 'shell'
        ? SHELL_PRIORITY
        : (PRIORITY[s.state] ?? PRIORITY.idle);
      if (priority >= PRIORITY.idle) continue;
      if (!best || priority < best.priority || (priority === best.priority && s.at > best.at)) {
        best = { priority, id, state: s.state, variant: s.variant, at: s.at };
      }
    }
    if (best) {
      emit({ actionId: best.state, variant: best.variant, sessionId: best.id }, 'session', now);
      return current;
    }

    // 没有活跃会话：按静默时长走 idle → away → sleeping
    const silent = now - lastActivityAt;
    if (lastActivityAt > 0 && silent > awayThreshold() + config.sleepMs) {
      emit({ actionId: 'sleeping', variant: null, sessionId: null }, 'silence', now);
      return current;
    }
    if (lastActivityAt > 0 && silent > awayThreshold()) {
      emit({ actionId: 'away', variant: null, sessionId: null }, 'silence', now);
      return current;
    }

    // idle 变体轮换，权重受 energy 影响
    if (now - idleVariantAt > config.idleVariantMs) {
      idleVariant = pickWeighted(idleWeights(energy), random);
      idleVariantAt = now;
    }
    emit({ actionId: idleVariant, variant: null, sessionId: null }, 'idle', now);
    return current;
  }

  return {
    observeEvent,
    observeRate,
    setEnergy,
    /** 推进时钟，让静默转场与 idle 轮换生效。 */
    tick: (now) => resolve(now),
    current: () => ({ ...current }),
    /** 诊断用：当前活跃会话与派生量。 */
    debug: () => ({
      energy,
      rate,
      awayThresholdMs: Math.round(awayThreshold()),
      sessions: [...sessions.entries()].map(([id, s]) => ({
        id, state: s.state, variant: s.variant, at: s.at, subagents: s.subagents.size,
      })),
    }),
  };
}

/** 由今日吞吐与个人基线算体力，与面板显示的公式必须一致。 */
export function energyFrom(todayThroughput, baseline) {
  if (!baseline || baseline <= 0) return 1;
  return Math.max(0, 1 - Math.min(1, todayThroughput / baseline));
}
