/**
 * 演示站的合成数据源。
 *
 * ⚠️ **全部是编的**，不含任何真实用量、真实项目名、真实路径或机器信息。
 * 这个文件会随静态站点发布到公网，而「纯本地」是这个项目的第一原则——
 * 把开发机的真实 rollup 打包进去，等于把「你在做什么项目、烧了多少钱」
 * 公开出去，正好背叛这条原则。所以这里一个真实数字都不能有。
 *
 * 结构上刻意**照抄运行时的 cell 模型**（按 来源 × 模型 × 项目 × 天 存格子），
 * 而不是预先算好一份总表。因为面板最核心的能力就是「任意维度组合筛选」，
 * 如果演示数据只有一份写死的总表，点筛选器不会有任何变化——
 * 那等于在演示站上假装产品有它没展示的能力。宁可多写这几十行。
 */
(function () {
  const DAY = 86_400_000;
  const now = Date.now();

  /** 编的项目名，刻意用通用词，不像任何真实仓库。 */
  const MIX = [
    // [来源, 模型, 项目, 权重]
    ['claude-code', 'claude-opus-5', 'demo-storefront', 0.20],
    ['claude-code', 'claude-opus-5', 'demo-api-gateway', 0.13],
    ['claude-code', 'claude-sonnet-5', 'demo-docs-site', 0.07],
    ['claude-code', 'claude-haiku-4-5', 'demo-scratch', 0.03],
    ['codex', 'gpt-5.6-sol', 'demo-storefront', 0.12],
    ['codex', 'gpt-5.6-sol', 'demo-mobile-app', 0.11],
    ['codex', 'gpt-5.6-sol', 'demo-api-gateway', 0.08],
    ['kimi-code', 'kimi-k3-code', 'demo-mobile-app', 0.07],
    ['kimi-code', 'kimi-k3-code', 'demo-scratch', 0.04],
    ['qwen-code', 'qwen3-coder-max', 'demo-docs-site', 0.06],
    ['grok', 'grok-code-fast-2', 'demo-scratch', 0.04],
    ['gemini-cli', 'gemini-3-pro', 'demo-api-gateway', 0.05],
  ];

  const SOURCE_LABELS = {
    'claude-code': 'Claude Code',
    codex: 'Codex CLI',
    'kimi-code': 'Kimi Code',
    'qwen-code': 'Qwen Code',
    grok: 'Grok CLI',
    'gemini-cli': 'Gemini CLI',
  };

  /** 这个模型故意不给价格，让「覆盖率 < 100%」这件事在演示里看得见。 */
  const UNPRICED = new Set(['kimi-k3-code']);

  const DAYS = 45;
  const dayKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** 造有作息感的曲线：周末低、周中高，再叠一点起伏。不要纯随机噪声。 */
  function dayScale(i) {
    const weekday = new Date(now - i * DAY).getDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.34 : 1;
    return weekend * (0.7 + 0.5 * Math.abs(Math.sin(i / 3.4)));
  }

  // 白天高、深夜低。索引即小时。
  const HOUR_SHAPE = Array.from({ length: 24 }, (_, h) =>
    (h < 7 ? 0.05 : h < 10 ? 0.5 : h < 13 ? 1 : h < 15 ? 0.7 : h < 20 ? 1 : h < 23 ? 0.6 : 0.18));

  const cells = [];
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const ms = now - i * DAY;
    const day = dayKey(ms);
    days.push(day);
    const scale = dayScale(i);
    for (const [source, model, project, weight] of MIX) {
      const k = scale * weight;
      cells.push({
        day, source, model, project,
        input: Math.round(2_600_000 * k),
        output: Math.round(820_000 * k),
        cacheRead: Math.round(74_000_000 * k),
        write5m: Math.round(980_000 * k),
        write1h: Math.round(610_000 * k),
        reasoning: Math.round(190_000 * k),
      });
    }
  }

  const KEYS = ['input', 'output', 'cacheRead', 'write5m', 'write1h', 'reasoning'];
  const zero = () => ({ input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0 });
  const add = (into, cell) => { for (const k of KEYS) into[k] += cell[k]; return into; };
  /** 与运行时同一套口径：billable 不含 cacheRead，throughput 含。 */
  const billable = (b) => b.input + b.write5m + b.write1h + b.output;
  const throughput = (b) => billable(b) + b.cacheRead;

  const RANGE_DAYS = { today: 1, week: 7, month: 30, all: DAYS };

  function computeSummary(query) {
    const range = query.range || 'today';
    const span = RANGE_DAYS[range] ?? 1;
    const window = new Set(days.slice(-span));
    const filters = {
      source: query.source || null,
      model: query.model || null,
      project: query.project || null,
    };
    const filtered = Boolean(filters.source || filters.model || filters.project);

    const total = zero();
    const byModel = {}, byProject = {}, bySource = {}, byDay = {};
    let priced = 0, unpriced = 0;
    const unpricedModels = new Set();

    for (const cell of cells) {
      if (!window.has(cell.day)) continue;
      if (filters.source && cell.source !== filters.source) continue;
      if (filters.model && cell.model !== filters.model) continue;
      if (filters.project && cell.project !== filters.project) continue;
      add(total, cell);
      add(byModel[cell.model] ??= zero(), cell);
      add(byProject[cell.project] ??= zero(), cell);
      add(bySource[cell.source] ??= zero(), cell);
      add(byDay[cell.day] ??= zero(), cell);
      const t = throughput(cell);
      if (UNPRICED.has(cell.model)) { unpriced += t; unpricedModels.add(cell.model); }
      else priced += t;
    }

    const tp = throughput(total);
    const hourly = HOUR_SHAPE.reduce((n, v) => n + v, 0);
    const daily = Object.entries(byDay).map(([day, b]) => ({
      day, ...b, billable: billable(b), throughput: throughput(b),
    }));

    return {
      range,
      filtered,
      hoursAvailable: true,
      days: daily.map((d) => d.day),
      ...total,
      cacheWrite: total.write5m + total.write1h,
      billable: billable(total),
      throughput: tp,
      hitRate: tp ? total.cacheRead / (total.cacheRead + total.write5m + total.write1h + total.input) : 0,
      // 把当期总量按作息形状摊到 24 小时上
      hours: HOUR_SHAPE.map((v) => Math.round(tp * (v / hourly))),
      byModel, byProject, bySource, daily,
      // 单价是编的，只为让成本卡片有东西显示
      cost: Number((priced / 1_000_000 * 1.42).toFixed(2)),
      unpricedTokens: unpriced,
      unpricedModels: [...unpricedModels],
      coverage: priced + unpriced ? priced / (priced + unpriced) : 1,
    };
  }

  const SETTINGS = {
    recordUsage: true,
    petEnergy: true,
    hookEnhancement: true,
    permissionBubble: false,
    lanMirror: false,
    cursorCloud: false,
    showCost: true,
    reducedMotion: false,
    primaryMetric: 'throughput',
    hiddenProjects: [],
    pinnedProjects: [],
  };

  const dims = (key) => [...new Set(MIX.map((m) => m[key]))];

  function summaryResponse(query) {
    const summary = computeSummary(query);
    const span = RANGE_DAYS[query.range || 'today'] ?? 1;
    const baselineSpan = Math.min(14, DAYS);
    // 基线 = 近 14 天的日均 throughput，与运行时的「个人化基线」同一个意思
    const recent = days.slice(-baselineSpan);
    const base = cells.filter((c) => recent.includes(c.day)).reduce((n, c) => n + throughput(c), 0) / baselineSpan;

    return {
      demo: true,
      range: query.range || 'today',
      filters: {
        source: query.source || null, model: query.model || null, project: query.project || null,
      },
      settings: SETTINGS,
      summary,
      sessions: {
        sessions: Math.round(4.2 * span),
        activeSeconds: Math.round(2100 * span),
        durationSeconds: Math.round(6400 * span),
        messageCount: Math.round(268 * span),
        userMessageCount: Math.round(31 * span),
        userPromptHours: HOUR_SHAPE.map((v) => Math.round(v * 6 * span)),
      },
      coverage: summary.coverage,
      baseline: Math.round(base * span),
      dimensions: { sources: dims(0), models: dims(1), projects: dims(2) },
      labels: SOURCE_LABELS,
      // 演示站不给本机路径，「在 Finder 打开」在公网上本来也没意义
      projectPaths: {},
      pricing: { fetchedAt: new Date(now - 2 * DAY).toISOString(), models: 348 },
      wrapped: {
        firstDay: days[0], lastDay: days.at(-1), activeDays: DAYS,
        peakHour: 13, topModel: 'claude-opus-5', topProject: 'demo-storefront', streak: 12,
      },
    };
  }

  /** 演示用的仲裁场景：多个来源同时在争，让「为什么是这个动作」看得见。 */
  const stateResponse = () => {
    const t = Date.now();
    return {
      demo: true,
      state: {
        actionId: 'delegating', variant: 'two-or-more-subagents',
        sessionId: 'demo-b', since: t - 4200, reason: 'session',
      },
      plan: {
        actionId: 'delegating', name: 'Parcel Stack',
        source: 'src/animations/hatchling-parade.svg',
        durationMs: 5000, mode: 'loop', variant: 'two-or-more-subagents',
        next: null, motion: true, fellBackFrom: null, aliasedFrom: null,
      },
      energyEnabled: true,
      debug: {
        energy: 0.58, rate: 47_300, awayThresholdMs: 231_000, minDwellMs: 1200, oneshot: null,
        sessions: [
          { id: 'demo-b', state: 'delegating', variant: 'two-or-more-subagents', at: t - 4200, subagents: 2, priority: 4, winner: true },
          { id: 'demo-a', state: 'working.reading', variant: null, at: t - 9800, subagents: 0, priority: 5, winner: false },
          { id: 'rate', state: 'working', variant: null, at: t - 2100, subagents: 0, priority: 6, winner: false },
        ],
        events: [
          { type: 'SubagentStart', kind: 'hook', at: t - 4200, session: 'demo-b' },
          { type: 'SubagentStart', kind: 'hook', at: t - 7400, session: 'demo-b' },
          { type: 'PreToolUse', kind: 'hook', at: t - 9800, session: 'demo-a', tool: 'Read' },
          { type: 'shell.hover', kind: 'shell', at: t - 15_200, action: 'interaction.hover' },
          { type: 'UserPromptSubmit', kind: 'hook', at: t - 21_000, session: 'demo-a' },
          { type: 'Stop', kind: 'hook', at: t - 46_000, session: 'demo-a', detail: 'complete' },
        ],
      },
    };
  };

  const NO_PATH = '（演示站不显示本机路径）';

  window.MaclawdDemo = {
    /** 由 build-site 注入：真实的动作清单（这是项目自己的设计产物，不是私人数据）。 */
    actions: [],
    summaryResponse,
    stateResponse,
    settings: SETTINGS,
    live: () => ({
      demo: true, tokensPerMin: 47_300, intensity: 1 - Math.exp(-47_300 / 60_000),
      sources: ['claude-code', 'codex'], trackedFiles: 1298, disabled: false,
      updatedAt: new Date().toISOString(),
    }),
    tools: () => ({
      demo: true,
      tools: Object.entries(SOURCE_LABELS).map(([id, label]) => ({
        id, label, dirs: [NO_PATH], installed: true,
      })),
    }),
    hooks: () => ({
      demo: true, path: NO_PATH, script: NO_PATH, missing: [],
      installed: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
        'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
        'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'CwdChanged'],
      permission: { installed: false, path: null, url: null },
    }),
    lan: () => ({ demo: true, enabled: false, token: null, urls: [] }),
    permissions: () => ({ demo: true, pending: [], enabled: false }),
  };
})();
