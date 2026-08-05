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
  // 睡眠链是一条单向链，越往后越深。任何真实事件都能立刻打断它——
  // 这些优先级只在「没有任何会话可显示」时才被用到。
  drowsing: 8.5,
  away: 9,
  collapsing: 9.5,
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

/**
 * 宠物**自己**决定去做的事。
 *
 * 与 idle 变体的区别不在观感，在**有没有目的**：擦爪是无聊时的抽动，
 * 溜达是它决定去别处看看。这条线是「桌宠」与「状态指示器」的分界——
 * 此前 41 个动作全部由 Agent 状态或用户操作驱动，宠物自己什么都不做。
 *
 * 这些**不声称任何 Agent 状态**，所以不违反契约的 truthPolicy
 * （「只从可靠信号选状态」）——它们根本不是状态，是宠物的行为。
 * 但正因为如此，它们必须能被任何真实状态**立刻**打断：
 * 宠物的自娱自乐不能盖住「Claude 卡住了」。所以走 oneshot 插播，
 * 而不是占住一个仲裁档位。
 */
const SELF_ACTS = [
  ['self.stretch', 40],
  ['self.peek', 35],
  ['self.roam', 25],
];

/** 各自的契约时长。与 design/runtime-lifecycle-actions.json 必须一致，测试会比对。 */
const SELF_ACT_MS = {
  'self.stretch': 3200,
  'self.peek': 2800,
  'self.roam': 4600,
};

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
  // 但也不能拖太久：这段时间里桌宠会一直「假装在工作」，而这正是
  // 实测里 idle 一次都没上过屏的原因之一（4 个会话全卡在 working）。
  //
  // 10 分钟是个取舍：比任何合理的工具调用都长（大型构建/测试一般 < 10 分钟，
  // 那期间显示 working.long 是对的），又短到人离开后不至于被骗太久。
  // 原来是 30 分钟，太偏向前者了。
  staleActiveMs: 10 * 60_000,
  // 全部会话静默多久后进入 away（energy 低时缩短）
  awayMs: 5 * 60_000,
  // 进入 away 之前先犯困。取 away 阈值的比例而不是绝对值——
  // energy 低时整条链一起缩短，「累的时候睡得早」才成立。
  drowsyRatio: 0.7,
  // away 之后多久撑不住倒下
  collapseMs: 30_000,
  // away 之后多久睡着（必须晚于 collapseMs，否则倒下那一段永远看不到）
  sleepMs: 60_000,
  // 无 hook 时，token 速率高于此值判定为 working
  workingRateThreshold: 200,
  // idle 变体轮换间隔
  idleVariantMs: 45_000,
  // 两次自发行为之间的最小间隔。太密会显得多动，太疏又等于没有——
  // 两分钟左右是「偶尔动一下」的量。
  selfActGapMs: 120_000,
  // 冷却结束之后，平均还要等多久才真的做一件自发的事。
  //
  // **这个量必须与 tick 频率无关。** 原来这里是「每次 tick 有 6% 概率」，
  // 那在 2 秒一拍时等价于平均再等 33 秒；后来服务端改成自己 100ms 推进一拍，
  // 同一个 6% 立刻变成平均再等 1.7 秒——自发行为从「大约每 2.5 分钟、
  // 时机随机」变成「每 2 分零 2 秒、像钟表一样准」。随机性正是它不显得
  // 机械的全部原因，按 tick 计概率等于把这个性质交给了一个实现细节。
  //
  // 33 秒是从原来那套参数换算过来的，保持手感不变。
  selfActMeanWaitMs: 33_000,
  // 单次 tick 最多折算多少时间的概率。见 selfActChance 的算式。
  selfActMaxAccrualMs: 2_000,
  // 同一个工作态持续多久算「久战」。三分钟是个分界：
  // 短于它多半是一次普通的工具调用，长于它用户会开始想「它是不是卡了」。
  longWorkMs: 3 * 60_000,
  // Stop 去抖窗口。只用于「后台任务还在跑但模型已经把话说完」这一种拿不准的情况：
  // 按住 working 这么久，期间有任何前进事件就取消，没有就照常兑现。
  // 2 秒是取舍——短于它挡不住紧接着的续跑，长于它庆祝会明显迟到。
  stopDebounceMs: 2_000,
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
  let lastSelfActAt = 0;
  /** 上一次走到自发行为判定的时刻。用来把概率换算成「单位时间」的。 */
  let lastTickAt = 0;
  let lastActivityAt = 0;
  /**
   * 「没东西可显示」是从什么时候开始的。
   *
   * 静默链（idle → away → sleeping）此前从 lastActivityAt 起算，但进入这条链的
   * 闸门是「还有没有活跃会话」——两个时间尺度对不上，后果是两个动作永远看不到：
   *
   *   - idle：会话 90 秒过期、away 阈值 105 秒（体力 0 时），
   *     **显示窗口只有 15 秒**，还要求这 15 秒里恰好没有新事件。实测 0 次。
   *   - away：活跃态会话要 30 分钟才兜底过期，那一刻 silent 早已越过
   *     away+sleep 线，直接判成 sleeping。away 那 60 秒被整个跳过。实测 0 次。
   *
   * 改成**会话清空的那一刻**起算。长时间跑的工具照常显示 working.long
   * （它的会话还在），而人真的离开后，完整的 idle → away → sleeping 才走得完。
   */
  let quietSince = 0;
  /**
   * 最后一次观察到**人还在**的时刻。
   *
   * 睡眠链此前完全由「agent 沉默了多久」驱动，那是个错误的依据：
   * 你读代码、写文档、开会、看别的窗口的时候 agent 全都是沉默的，
   * 而人一直在；反过来 agent 跑长任务时你完全可以去泡咖啡。
   * **这两件事本来就是正交的**，用一个去推另一个永远会错一半。
   *
   * 于是加第二根轴：外壳轮询光标位置，动了就报 shell.presence；
   * 人自己敲的 UserPromptSubmit 同样算。睡眠链改成「两个条件都满足才走」——
   * agent 静下来了**并且**人也不在。
   *
   * 0 表示「从来没有过存在信号」（外壳不支持、或纯引擎测试），
   * 这时 max(quietSince, 0) 退化回旧行为，不会凭空多睡或少睡。
   */
  let presenceAt = 0;
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

/**
 * 参与并发计数的状态。tier 分档要回答的是「同时有几个会话在干活」，
 * 所以只数真正在产出的那些——idle / away / sleeping 不算。
 */
const BUSY_STATES = new Set(['thinking', 'working', 'delegating', 'compacting']);

/**
 * 合成会话：不是真实的 agent，不该被计入并发。
 *   `rate`  —— 无 hook 时的速率推断兜底
 *   `shell` —— 外壳自己的交互事件
 * 把它们算进去会让「开了几个窗口」这个数凭空多一两个。
 */
const SYNTHETIC_SESSIONS = new Set(['rate', 'shell']);

  const session = (id) => {
    let s = sessions.get(id);
    if (!s) {
      s = {
        state: 'idle', variant: null, at: 0, subagents: new Set(), pendingPermission: false,
        // 被去抖按住、还没兑现的 Stop。见 stopGate。
        pendingStop: null,
      };
      sessions.set(id, s);
    }
    return s;
  };

  /** 同时有几个真实会话在产出。tier 分档据此换素材，状态 id 不变。 */
  function busyCount() {
    let n = 0;
    for (const [id, s] of sessions) {
      if (SYNTHETIC_SESSIONS.has(id)) continue;
      const base = String(s.state).split('.')[0];
      if (BUSY_STATES.has(base)) n += 1;
    }
    return n;
  }

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

  /**
   * 这次 Stop 该怎么处理。
   *
   * 'hold'      —— 确定还有活在跑，按住 working 不放，永不自动兑现
   * 'debounce'  —— 拿不准，按住一个安静窗口再说
   * 'complete'  —— 真的结束了，照常收尾
   *
   * 判据与 clawd-on-desk 的 #406 一致（他们踩过同一个坑）：
   * cron 挂着、Stop hook 否决、后台任务还在跑且没有最终回复文本，
   * 这三种都不是回合结束。后台任务**已经**有最终回复文本时不硬按——
   * 模型已经把话说完了，后台那条命令跑不跑完不该拖住庆祝，
   * 但仍然给一个短窗口，免得紧接着的续跑把庆祝夹在中间。
   */
  function stopGate(event) {
    const crons = Number(event?.sessionCrons) || 0;
    const background = Number(event?.backgroundTasks) || 0;
    const hookActive = event?.stopHookActive === true;
    // disposition === 'complete' 意味着最后一条 assistant 消息是 end_turn，
    // 也就是「模型确实把话说完了」——正好是我们要的 hasFinalAssistantText。
    const hasFinalText = event?.disposition === undefined || event?.disposition === 'complete';

    if (crons > 0 || hookActive || (background > 0 && !hasFinalText)) return 'hold';
    if (background > 0) return 'debounce';
    return 'complete';
  }

  /** 真正兑现一次 Stop。按住与去抖两条路最终都汇到这里。 */
  function applyStop(s, disposition, now) {
    s.state = 'idle';
    s.variant = null;
    // 只有确认是自然收尾才庆祝。用户按 ESC 打断时 Stop 照样触发，
    // 那时候欢呼是会烦人的。写入器读 transcript 尾部判定，
    // 判不出来就安静收场——宁可少一个动作，不要说错话。
    // 没有 disposition 字段时按老行为庆祝（面板手动触发、旧版写入器）。
    if (disposition === undefined || disposition === 'complete') {
      pushOneshot('success', now);
    }
  }

  /**
   * 任何「循环还在跑」的事件都取消待兑现的 Stop。
   *
   * 这一条不能漏：漏了的话，一个被去抖按住的 Stop 会在几秒后突然兑现，
   * 把一个**已经继续跑起来的**会话打回 idle 并欢呼一次。
   */
  const COMPLETION_CANCEL = new Set([
    'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolBatch', 'PostToolUseFailure',
    'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
    'PermissionRequest', 'PermissionResolved', 'Notification', 'StopFailure', 'SessionEnd',
  ]);

  /**
   * 人还在。
   *
   * 刻意**不**更新 lastActivityAt：那个变量的语义是「agent 有过动静」，
   * 混进人的动静会让「为什么它还在演工作」变得没法解释。两根轴各记各的。
   *
   * 睡着时被这个信号唤醒是对的——你回到座位，它伸个懒腰醒过来。
   * 这也是 waking（Morning Stretch）在真实使用中唯一稳定的触发源：
   * 之前要等 agent 先来事件，而人回来的第一件事往往是先动鼠标。
   */
  function observePresence(now = 0) {
    presenceAt = now;
    if (wakeIfAsleep(now)) resolve(now);
  }

  /**
   * 当前在屏幕上的那个状态，是谁发起的。
   *
   * 给外壳用：桌宠亮着 needs_owner 的时候，点它就跳回**那个**终端窗口。
   * 只在赢家是真会话时有值——静默链、自发行为、外壳交互都不属于任何终端。
   */
  function focusTarget() {
    const s = current.sessionId ? sessions.get(current.sessionId) : null;
    if (!s?.pid) return null;
    return { pid: s.pid, cwd: s.cwd ?? null };
  }

  function observeEvent(event, now = 0) {
    const { type, sessionId: externalId = 'default' } = event ?? {};
    if (!type) return;
    const sourceAgent = ['claude-code', 'codex', 'workbuddy'].includes(event?.agentId);
    const sessionId = sourceAgent
      ? `${event.agentId}:${externalId}`
      : externalId;

    // 存在信号不是动作，只是「人还在」的一次打卡：不进会话表、不参与仲裁、
    // 也不该 logEvent（外壳每 20 秒报一次，会把事件日志淹掉）。
    if (type === 'shell.presence') {
      observePresence(now);
      return;
    }

    // 外壳事件走单独一条路：它们不属于任何 agent 会话。
    const shellAction = SHELL_ACTIONS[type];
    if (shellAction) {
      logEvent(type, 'shell', now, { action: shellAction });
      lastActivityAt = now;
      // 戳它、拖它、把鼠标停在它上面——都是人干的，一律算存在。
      presenceAt = now;
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
    s.externalId = externalId;
    if (sourceAgent) s.agentId = event.agentId;
    if (typeof event.channel === 'string') s.channel = event.channel;
    s.at = now;
    // 发起方信息。每个事件都可能带，取最后一次——同一个会话换终端的情况
    // （tmux attach 到别处）下，新的那个才是你现在能跳过去的。
    if (Number.isInteger(event.pid) && event.pid > 1) s.pid = event.pid;
    if (typeof event.cwd === 'string' && event.cwd) s.cwd = event.cwd;
    // 循环还在跑 → 取消待兑现的 Stop。必须在 switch 之前，
    // 否则一个已经继续跑起来的会话会在几秒后被旧的 Stop 打回 idle。
    if (COMPLETION_CANCEL.has(type)) s.pendingStop = null;
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
        // 有人刚敲了一段字进去——这是最硬的存在证据，比光标移动还硬。
        // 光靠光标会漏掉「一直在终端里打字、鼠标没动过」的人。
        presenceAt = now;
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
        if (event.subagentId ?? event.agentId) s.subagents.add(event.subagentId ?? event.agentId);
        s.state = 'delegating';
        s.variant = s.subagents.size >= 2 ? 'two-or-more-subagents' : 'one-subagent';
        break;
      case 'SubagentStop':
        if (event.subagentId ?? event.agentId) s.subagents.delete(event.subagentId ?? event.agentId);
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
        } else if (event.agentId === 'workbuddy') {
          // WorkBuddy 的权限提示通过 Notification 到达，但部分版本不附带
          // notification_type。只显示“需要关注”的未知变体，不把它伪装成已知权限。
          s.state = 'needs_owner';
          s.variant = 'unknown';
        }
        break;
      case 'PermissionResolved':
        if (s.pendingPermission) {
          s.pendingPermission = false;
          if (event.resolution !== 'timeout') pushOneshot('owner_resolved', now);
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
      case 'Stop': {
        const gate = stopGate(event);
        if (gate === 'hold') {
          // 硬按住：确定还有活在跑，这个 Stop 根本不是回合结束。
          // 状态保持 working，**事件本身不留痕**——不欢呼、不回 idle、
          // 也不重置 stateSince（否则久战计时会被反复清零，working.long 再也升不上去）。
          if (!String(s.state).startsWith('working')) s.state = 'working';
          s.pendingStop = null;
          break;
        }
        if (gate === 'debounce') {
          // 拿不准：先按住 working，给一个安静窗口。窗口内任何前进事件
          // 都会取消它（见 COMPLETION_CANCEL）；窗口过完还没动静，
          // resolve() 会把这次 Stop 补上，该欢呼的照样欢呼。
          if (!String(s.state).startsWith('working')) s.state = 'working';
          s.pendingStop = { at: now, disposition: event.disposition };
          break;
        }
        s.pendingStop = null;
        applyStop(s, event.disposition, now);
        break;
      }
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

  function pushOneshot(id, now, durationMs = 3000) {
    oneshot = { id, until: now + durationMs };
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
    // 兑现过了安静窗口的 Stop。**必须排在一次性动作那道闸门之前**——
    // 兑现动作本身会插播 success，排在闸门之后的话这一帧看不到它，
    // 庆祝要等到下一次 tick 才出现（实测：迟一整帧）。
    for (const s of sessions.values()) {
      if (s.pendingStop && now - s.pendingStop.at >= config.stopDebounceMs) {
        const { disposition } = s.pendingStop;
        s.pendingStop = null;
        applyStop(s, disposition, now);
      }
    }

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
        best = { priority, id, state, variant: s.variant, at: s.at, pid: s.pid, cwd: s.cwd };
      }
      s.priority = priority;
    }
    if (best) {
      quietSince = 0;
      emit({ actionId: best.state, variant: best.variant, sessionId: best.id },
        'session', now, best.priority);
      return current;
    }

    // 没有可显示的会话了。静默链从**这一刻**起算，而不是从最后一次事件——
    // 见 quietSince 的说明。
    if (!quietSince) quietSince = now;
    // 两根轴取更晚的那个：agent 静下来了**并且**人也走了，才开始倒计时。
    // 人还在的时候 presenceAt 一直被刷新，silent 恒接近 0，链条根本不启动——
    // 于是显示的是 idle（那个专门画了 5 个图层的安静观察），而不是睡着。
    const silent = now - Math.max(quietSince, presenceAt);
    // 从深到浅依次判断。顺序不能反——先判浅的会让链条永远停在第一段。
    if (lastActivityAt > 0) {
      const away = awayThreshold();
      const stage = silent > away + config.sleepMs ? 'sleeping'
        : silent > away + config.collapseMs ? 'collapsing'
          : silent > away ? 'away'
            : silent > away * config.drowsyRatio ? 'drowsing'
              : null;
      if (stage) {
        emit({ actionId: stage, variant: null, sessionId: null }, 'silence', now);
        return current;
      }
    }

    // 宠物自己决定做点什么。只在**真正空闲**时发生（走到这里就说明
    // 没有任何会话可显示、也还没到犯困），而且要隔够久。
    // energy 低时不做——累了就不折腾了。
    //
    // 概率按**过去了多少时间**算，不按「又 tick 了一次」算：
    // 指数分布下，dt 时间内至少发生一次的概率是 1 - e^(-dt/平均等待)。
    // 这样 100ms 一拍和 2s 一拍得到同样的手感，调 tick 频率不会顺手
    // 把宠物的性格也改掉（见 selfActMeanWaitMs 的说明）。
    // 累积窗口要封顶。不封的话，一次长时间不 tick（机器睡了一觉、
    // 外壳被暂停、或者测试里直接跳到 5 分钟后）会让概率逼近 1，
    // 下一拍必然做一件自发的事——可那段时间宠物根本没在被看着，
    // 那些"没观察到的时间"不该折算成概率。
    // 上限取 2 秒（原来外壳的轮询周期），任何比它快的 tick 都保持等价。
    const sinceTick = lastTickAt
      ? Math.min(Math.max(0, now - lastTickAt), config.selfActMaxAccrualMs)
      : 0;
    lastTickAt = now;
    const selfActChance = 1 - Math.exp(-sinceTick / config.selfActMeanWaitMs);
    // `selfActChance > 0` 要排在 random() 前面：第一次 tick 的 sinceTick 是 0，
    // 概率也是 0，这时候没有必要——也不应该——去消耗一次随机数。
    // 消耗了的话，任何按调用序列钉死随机源的测试都会被这一次空转打乱奇偶。
    if (energy > 0.35
      && selfActChance > 0
      && now - lastSelfActAt > config.selfActGapMs
      && random() < selfActChance) {
      lastSelfActAt = now;
      const act = pickWeighted(SELF_ACTS, random);
      // 自发行为按各自的契约时长播完，不套用 oneshot 的 3 秒默认值——
      // 溜达播到一半被切回 idle 会读成「走一半又不走了」。
      pushOneshot(act, now, SELF_ACT_MS[act] ?? 3000);
      // 必须**当场发出**。只 push 不 emit 的话要等下一次 resolve 才上屏，
      // 而 resolve 由外部时钟驱动——中间这段时间显示的还是上一个动作。
      emit({ actionId: act, variant: null, sessionId: null }, 'oneshot', now);
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

  // busy 与 focus 都实时算，不在 emit 时冻结：emit 只在动作**变化**时触发，
  // 而多开一个窗口并不改变赢家——冻结下来的并发数会一直是旧的。
  // focus 同理，一个持续 working 的会话不会再 emit，但它的 pid 一直有效。
  const snapshot = () => ({ ...current, busy: busyCount(), focus: focusTarget() });

  /**
   * 从磁盘租约恢复在途会话。
   *
   * hook 每次都往磁盘写一份租约，**不依赖服务在线**——这正是它的意义：
   * 桌宠没开的那段时间里，租约是唯一留下的痕迹。启动时读回来，
   * 桌宠就不会在一个任务跑到一半的时候从 idle 开始演。
   *
   * `at` 用租约里记的事件时刻，不是"现在"：一份 12 分钟前写的 working
   * 租约，恢复后应该只剩不到 3 分钟就被兜底过期，而不是重新计时 10 分钟。
   */
  function restore(leases, now = Date.now()) {
    let restored = 0;
    for (const lease of leases ?? []) {
      if (!lease?.sessionId || !lease.state) continue;
      const id = lease.agentId ? `${lease.agentId}:${lease.sessionId}` : lease.sessionId;
      const s = session(id);
      s.externalId = lease.sessionId;
      s.agentId = lease.agentId ?? null;
      s.state = lease.state;
      s.at = Number.isFinite(lease.at) ? lease.at : now;
      s.stateSince = s.at;
      if (Number.isInteger(lease.pid) && lease.pid > 1) s.pid = lease.pid;
      if (typeof lease.cwd === 'string' && lease.cwd) s.cwd = lease.cwd;
      lastActivityAt = Math.max(lastActivityAt, s.at);
      restored += 1;
    }
    if (restored) resolve(now);
    return restored;
  }

  return {
    observeEvent,
    observeRate,
    observePresence,
    restore,
    setEnergy,
    /**
     * 推进时钟，让静默转场与 idle 轮换生效。
     *
     * 返回的是**加料后**的快照。此前这里直接把内部的 current 抛出去，
     * 少了 busy —— 而服务端正是拿 `state.busy` 去挑并发分档的，
     * `Number.isFinite(undefined)` 为假，于是分档静默地一次都没生效过：
     * 素材做好了、收敛表配好了、测试也过了，唯独真实路径上传的是 undefined。
     */
    tick: (now) => { resolve(now); return snapshot(); },
    current: snapshot,
    sessions: () => [...sessions.entries()]
      .filter(([id]) => !SYNTHETIC_SESSIONS.has(id))
      .map(([id, s]) => ({
        id,
        externalId: s.externalId ?? id,
        agentId: s.agentId ?? null,
        channel: s.channel ?? null,
        state: s.state,
        variant: s.variant,
        at: s.at,
        stateSince: s.stateSince ?? s.at,
        subagents: s.subagents.size,
        pid: s.pid ?? null,
        cwd: s.cwd ?? null,
        winner: id === current.sessionId,
      })),
    /** 诊断用：当前活跃会话与派生量。 */
    debug: () => ({
      energy,
      rate,
      awayThresholdMs: Math.round(awayThreshold()),
      // 睡眠链的两个内部时钟。不暴露的话，「为什么还没睡」只能靠读代码猜——
      // 排查时这两个数是唯一能自证的东西。
      lastActivityAt,
      quietSince,
      // 第二根轴。面板上「为什么它不睡」只有看到这个数才解释得通。
      presenceAt,
      minDwellMs: config.minDwellMs,
      oneshot: oneshot ? { id: oneshot.id, until: oneshot.until } : null,
      busy: busyCount(),
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
