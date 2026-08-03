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
  // 工具刚失败、正在重试。比普通工作更值得看见——「它在挣扎」是
  // 用户会据此决定要不要介入的信息，而这个信号此前被整个丢掉了。
  'working.retrying': 4.8,
  // 只保留跑得够久、看得见的两个。Read/Edit 几毫秒就返回，
  // 修饰一闪而过，真机试跑时实测看不见——为它们各画一套是白费。
  'working.building': 5,
  'working.testing': 5,
  // 同一件事干很久。「跑了 10 秒」和「跑了 10 分钟」是完全不同的信息，
  // 此前无法区分。优先级压在通用 working 之上一点点。
  'working.long': 5.8,
  working: 6,
  thinking: 7,
  idle: 8,
  away: 9,
  sleeping: 10,
};

/** 一次性动作：插播完毕回到当前最高优先级的循环态。 */
export const ONESHOT = new Set([
  'launching', 'quitting', 'success', 'owner_resolved',
  'recovering', 'waking',
  // 交互反应也是插播：摸一下、吓一跳、落地
  'interaction.click', 'interaction.double_click', 'interaction.drop',
  // interaction.hover 不在此列：契约里它是 held——悬停持续期间保持，
  // 鼠标移开才结束。当成 oneshot 会让它播完就走，与「注视」这个语义相反。
  'ambient.power_connected',
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
  // held 必须成对：没有退出信号，注视状态会一直挂着不走
  'shell.hoverEnd': 'idle',
  'shell.screenEdge': 'ambient.edge',
  'shell.lowBattery': 'ambient.low_battery',
  'shell.powerConnected': 'ambient.power_connected',
  'shell.offline': 'ambient.offline',
  // 网络恢复不给专门动作：回到之前的状态本身就是信号。
  // （offline / needs_owner / error 之所以有收尾动作，是因为它们开了道具环要闭合；
  //   reconnected 没开过任何环。）走 hoverEnd 同一条路：清掉 shell 会话。
  'shell.reconnected': 'idle',
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
/**
 * 工具 → 工作修饰。
 *
 * 刻意**留空**。这里原本把 Read/Grep 映射到 working.reading、
 * Write/Edit 映射到 working.writing——但这些工具几毫秒就返回，
 * 修饰在屏幕上一闪而过，真机试跑时根本看不见。
 * 为看不见的东西各画一套动作是白费；它们统一回落通用 Tile Stack。
 *
 * 仍然保留修饰的只有 Bash 分类出的 building / testing（见下方 BASH_PATTERNS）：
 * 那些命令跑几十秒，有足够时间被看到，而且「测试在跑」是用户
 * 会据此决定等不等的信息。判据是**能不能被看见**，不是好不好看。
 */
export const TOOL_MODIFIERS = {};

/**
 * Bash 命令的三分类是**启发式**，不是可靠事件。按契约精神，只有高置信度模式
 * 才升级到具体修饰，否则老实回落通用 Tile Stack。
 *
 * command 字符串只用于这里的正则判断，绝不落盘（token-tracking.md 原则 2）。
 */
const BASH_PATTERNS = [
  [/\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|jest|vitest)\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b/, 'working.testing'],
  [/\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?build\b|\bmake\b|\bcargo\s+build\b|\bgo\s+build\b|\btsc\b|\bwebpack\b|\bvite\s+build\b/, 'working.building'],
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
  // 会话静默多久后退出活跃集（idle 级）
  sessionIdleMs: 90_000,
  // 活跃态（working / thinking / needs_owner…）的兜底过期。
  // 这些状态**不该**被 90 秒收掉——长时间跑的工具本来就没有中间事件。
  // 但也不能永不过期：会话被 kill -9 时 Stop / SessionEnd 都不会来，
  // 没有兜底的话桌宠会永远卡在「正在工作」，再也不会睡。
  staleActiveMs: 30 * 60_000,
  // 全部会话静默多久后进入 away（energy 低时缩短）
  awayMs: 5 * 60_000,
  // away 之后多久睡着
  sleepMs: 60_000,
  // 无 hook 时，token 速率高于此值判定为 working
  workingRateThreshold: 200,
  // idle 变体轮换间隔
  idleVariantMs: 45_000,
  // 同一个工作态持续多久算「久战」。三分钟是个分界：
  // 短于它多半是一次普通的工具调用，长于它用户会开始想「它是不是卡了」。
  longWorkMs: 3 * 60_000,
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

  /**
   * 最近事件的环形缓冲。
   *
   * 面板此前答不出两个问题：hook 到底有没有在送事件？桌宠为什么是现在这个动作？
   * 前者在 hook 静默失败时尤其要命——一切看起来正常，只是永远停在速率推断上。
   * 这里只记录**已经脱敏过的元数据**（类型、来源、结果动作），
   * 命令原文与 prompt 从来就没进过引擎。
   */
  const EVENT_LOG_MAX = 24;
  const eventLog = [];

  function logEvent(type, kind, at, extra) {
    eventLog.push({ type, kind, at, ...extra });
    if (eventLog.length > EVENT_LOG_MAX) eventLog.shift();
  }

  const session = (id) => {
    let s = sessions.get(id);
    if (!s) {
      s = { state: 'idle', variant: null, at: 0, subagents: new Set(), pendingPermission: false };
      sessions.set(id, s);
    }
    return s;
  };

  function emit(next, reason, now, priority) {
    if (next.actionId === current.actionId && next.variant === current.variant) return;

    // 最小驻留：优先级不高于当前的状态，要等驻留期满才能替换。
    // 一次性插播与更高优先级的状态不受限制——要人决定、出错必须立刻可见。
    //
    // 优先级必须由**调用方**给出。此前这里按 actionId 反查 PRIORITY 表，
    // 而 interaction.* 与 ambient.* 一个都不在表里，于是全被当成 idle(8) 级，
    // 被驻留中的 thinking(7) / working(6) 挡住，永远上不了屏——
    // 仲裁明明已经判它们赢了。`waiting` 当年就是这么消失的（见 PRIORITY 表的注释），
    // 拖拽是同一个坑的第二次：resolve() 用 SHELL_PRIORITY 判赢，
    // emit() 却反查不到、按 idle 处理，于是拖起来的姿势根本不显示。
    const incoming = priority ?? PRIORITY[next.actionId] ?? PRIORITY.idle;
    const holding = current.priority ?? PRIORITY[current.actionId] ?? PRIORITY.idle;
    const elapsed = now - current.since;
    if (
      reason !== 'oneshot'
      && current.reason !== 'init'
      && incoming >= holding
      && elapsed < config.minDwellMs
    ) return;

    current = { ...next, since: now, reason, priority: incoming };
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
      logEvent(type, 'shell', now, { action: shellAction });
      lastActivityAt = now;
      if (ONESHOT.has(shellAction)) {
        pushOneshot(shellAction, now);
        // 落地是拖拽的**终止**事件，必须顺手清掉还持有着的 interaction.drag。
        // 不清的话：Drop Wobble 播完会掉回「还挂在吊环上」，而 shell 会话的
        // 优先级 4.3 压过 working(6) 与 thinking(7)，桌宠就卡在拖拽姿势里出不来，
        // 直到鼠标移开触发 hoverEnd 才自愈——用户只会看到「拖完就不动了」。
        if (type === 'shell.drop') sessions.delete('shell');
      } else {
        const s = session('shell');
        s.state = shellAction;
        s.at = now;
        // 持续态（拖拽中、贴边、低电量、暂停）要能被主动清除
        if (type === 'shell.resumed' || type === 'shell.hoverEnd'
          || type === 'shell.reconnected') sessions.delete('shell');
      }
      resolve(now);
      return;
    }

    logEvent(type, 'hook', now, {
      session: sessionId,
      tool: event.toolName ?? null,
      detail: event.commandClass ?? event.matcher ?? event.disposition ?? null,
    });

    const s = session(sessionId);
    s.at = now;
    // 先判断再更新时间戳：wakeIfAsleep 要看的是「醒来之前」的状态
    const wasAsleep = wakeIfAsleep(now);
    lastActivityAt = now;
    // 进入当前状态的时刻。`s.at` 是**最后一次事件**的时间，不是这个——
    // 一个跑了十分钟的任务每几秒就有事件进来，s.at 一直在刷新，
    // 用它算不出「这件事干了多久」。
    const before = s.state;

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
      case 'PostToolUseFailure':
        // 工具执行失败。不升级到 error（那是整轮失败），但也不该退回
        // 通用 working——那等于把「刚才那步没成功」这个信号丢掉。
        // Claude 经常静默重试，用户只看到它一直在忙，不知道它在原地打转。
        s.state = 'working.retrying';
        s.failedAt = now;
        break;
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
        // 不再插播 workspace（Workspace Folder）。切工作目录是低信息事件，
        // 而 oneshot 插播会**打断**真正在演的动作——代价大于收益。
        s.state = 'working';
        break;
      case 'TeammateIdle':
        s.state = 'waiting';
        break;
      case 'Stop':
        s.state = 'idle';
        s.variant = null;
        // 只有确认是自然收尾才庆祝。用户按 ESC 打断时 Stop 照样触发，
        // 那时候欢呼是会烦人的。写入器读 transcript 尾部判定，
        // 判不出来就安静收场——宁可少一个动作，不要说错话。
        // 没有 disposition 字段时按老行为庆祝（面板手动触发、旧版写入器）。
        if (event.disposition === undefined || event.disposition === 'complete') {
          pushOneshot('success', now);
        }
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
    // 状态真的变了才重置计时；同一个状态被反复确认不算重新开始。
    if (s.state !== before) s.stateSince = now;
    else if (s.stateSince === undefined) s.stateSince = now;

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

    // 清理静默会话。**两档超时**，因为这里有一对相反的需求：
    //
    // - 长时间跑的工具（npm test 三分钟不出事件）不能中途掉回 idle，
    //   所以活跃态不能用 90 秒那档。
    // - 但会话被 kill -9 / 关终端时 Stop 与 SessionEnd 都不会来，
    //   只用「活跃态永不过期」的话它会**永远**卡在 working 上，
    //   桌宠再也不会进 away / sleeping——用户明确在意的那条睡眠链就死了。
    //
    // 于是：idle 级 90 秒收，活跃态给一个明显更长的兜底。
    // 一个 30 分钟没有任何 hook 事件的「正在工作」，只可能是源头断了。
    for (const [id, s] of sessions) {
      const silent = now - s.at;
      const limit = PRIORITY[s.state] >= PRIORITY.idle
        ? config.sessionIdleMs
        : config.staleActiveMs;
      if (silent > limit) sessions.delete(id);
    }

    // 取所有活跃会话里优先级最高的；同级取最近
    let best = null;
    for (const [id, s] of sessions) {
      // 通用 working 干够久就升级成久战。**只升级通用 working**：
      // testing / building 已经说明了在干什么，retrying 更紧急，
      // 都不该被「干很久」这条更弱的信息盖掉。
      const state = (s.state === 'working'
        && s.stateSince !== undefined
        && now - s.stateSince >= config.longWorkMs)
        ? 'working.long'
        : s.state;
      const priority = id === 'shell'
        ? SHELL_PRIORITY
        : (PRIORITY[state] ?? PRIORITY.idle);
      if (priority >= PRIORITY.idle) continue;
      if (!best || priority < best.priority || (priority === best.priority && s.at > best.at)) {
        best = { priority, id, state, variant: s.variant, at: s.at };
      }
      s.priority = priority;
    }
    if (best) {
      emit({ actionId: best.state, variant: best.variant, sessionId: best.id },
        'session', now, best.priority);
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
      minDwellMs: config.minDwellMs,
      oneshot: oneshot ? { id: oneshot.id, until: oneshot.until } : null,
      sessions: [...sessions.entries()].map(([id, s]) => ({
        id,
        state: s.state,
        variant: s.variant,
        at: s.at,
        subagents: s.subagents.size,
        // 仲裁用的优先级——面板据此解释「为什么是它赢」
        priority: id === 'shell' ? SHELL_PRIORITY : (PRIORITY[s.state] ?? PRIORITY.idle),
        winner: id === current.sessionId,
      })),
      events: [...eventLog].reverse(),
    }),
  };
}

/** 由今日吞吐与个人基线算体力，与面板显示的公式必须一致。 */
export function energyFrom(todayThroughput, baseline) {
  if (!baseline || baseline <= 0) return 1;
  return Math.max(0, 1 - Math.min(1, todayThroughput / baseline));
}
