import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsers, SOURCE_LABELS } from './parsers/index.js';
import { scanAll } from './scan.js';
import {
  buildRollup, summarize, baseline, splitCellKey,
  RANGES, ROLLUP_VERSION, rangeBounds,
} from './rollup.js';
import { costOf, updatePrices, pricingMeta } from './pricing.js';
import { billable } from './usage-record.js';
import { summarizeSessions } from './sessions.js';
import { queryUsageAnalytics } from './analytics.js';
import { intensityFromRate } from './tail.js';
import { createCollector } from './daemon.js';
import { createStateEngine, energyFrom } from './state-engine.js';
import {
  installHooks, uninstallHooks, hookStatus,
  installPermissionHook, uninstallPermissionHook, permissionHookStatus,
} from './hook-install.js';
import {
  installCodexHooks, uninstallCodexHooks,
  installCodexPermissionHook, uninstallCodexPermissionHook,
} from './codex-hook-install.js';
import {
  installWorkBuddyHooks, uninstallWorkBuddyHooks,
} from './workbuddy-hook-install.js';
import { installCursorHook, uninstallCursorHook } from './cursor-hook-install.js';
import { agentConnections, runAgentDoctor } from './agent-registry.js';
import {
  changeAgentIntegration, supportsAgentIntegration,
} from './agent-integration-action.js';
import { createCodexSessionMonitor } from './codex-session-monitor.js';
import { createClaudeSessionMonitor } from './claude-session-monitor.js';
import {
  installStatusline, uninstallStatusline, statuslineStatus,
} from './statusline-install.js';
import {
  readQuota, recordQuota, clearQuota, pendingAlerts, markAlerted, QUOTA_FILE,
} from './account-quota.js';
import { createCodexQuotaCollector } from './codex-quota.js';
import { createCursorQuotaCollector } from './cursor-quota.js';
import { createGrokQuotaCollector } from './grok-quota.js';
import { createWorkBuddyQuotaCollector } from './workbuddy-quota.js';
import { createPermissionBroker, decisionResponse } from './permissions.js';
import { authorize, currentToken, pairingUrls, resetToken, rotateToken } from './lan.js';
import { createOrchestrator } from './orchestrator.js';
import { loadSettings, saveSettings, usageEnabled } from './settings.js';
import { readJson, writeJson, removeJson } from './store.js';
import { COVERAGE_FILE, ROLLUP_FILE, SCAN_CACHE_FILE, TAIL_STATE_FILE } from './paths.js';
import { classify, createCoverage } from './coverage.js';
import { clearEndpoint, writeEndpoint } from './endpoint.js';
import { readLeases } from './session-lease.js';
import { watchHooks } from './hook-health.js';
import { createManagerWatch } from './manager-watch.js';
import { offboard } from './offboard.js';
import {
  createRuntimeIdentity, managementTokenMatches, publicRuntimeIdentity,
} from './runtime-identity.js';
import {
  sessionAgentLabel, sessionStateLabel, sessionStatePriority,
} from './session-presentation.js';

/**
 * 本地前端服务。零依赖，只绑 127.0.0.1。
 *
 * 静态 HTML 无法读取 ~/Library/Application Support，所以由这层把 rollup 暴露成 API，
 * 同时保持仓库「无构建步骤」的传统——前端是可以直接打开看的 HTML，不需要打包。
 * 将来 Swift 外壳可以复用同一套页面（WKWebView）或照此重写原生界面。
 */

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WEB_ROOT = join(REPO_ROOT, 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolvePromise(data));
    req.on('error', reject);
  });
}

/** 只允许读取仓库内的 web/ 与 src/animations/，防止路径穿越。 */
function resolveStatic(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean.startsWith('/src/animations/')
    ? [join(REPO_ROOT, clean)]
    : [join(WEB_ROOT, clean)];
  for (const candidate of candidates) {
    const full = resolve(candidate);
    if (!full.startsWith(REPO_ROOT)) continue;
    try {
      if (statSync(full).isFile()) return full;
    } catch {
      // 不存在，继续
    }
  }
  return null;
}

// ---------- 派生数据 ----------

/**
 * 读取聚合数据，并校验结构版本。
 *
 * 版本不匹配时返回 null 而不是硬着头皮解析——旧结构里没有 cells，继续解析会
 * 得到一片 0，而「显示 0」和「没有数据」在用户眼里是同一回事，会被当成 bug。
 * 宁可明确要求重新扫描。
 */
function loadRollup() {
  const rollup = readJson(ROLLUP_FILE, null);
  if (!rollup) return null;
  if (rollup.v !== ROLLUP_VERSION) return { stale: true };
  return rollup;
}

/** 全部出现过的维度值，供前端做筛选下拉。 */
function dimensions(rollup) {
  const sources = new Set();
  const models = new Set();
  const projects = new Set();
  for (const day of Object.values(rollup?.days ?? {})) {
    for (const [sourceId, sourceBucket] of Object.entries(day.sources ?? {})) {
      sources.add(sourceId);
      for (const cell of Object.keys(sourceBucket.cells ?? {})) {
        const parts = splitCellKey(cell);
        models.add(parts.model);
        projects.add(parts.project);
      }
    }
  }
  return {
    sources: [...sources].sort(),
    models: [...models].sort(),
    projects: [...projects].sort(),
  };
}

function rangeStartEpoch(range, now = new Date()) {
  if (range === 'all') return null;
  const b = rangeBounds(now);
  const key = {
    today: b.today,
    yesterday: b.yesterday,
    week: b.weekStart,
    last_week: b.lastWeekStart,
    month: b.monthStart,
    year: b.yearStart,
  }[range];
  if (!key) return null;
  return new Date(`${key}T00:00:00`).getTime();
}

/**
 * 年度回顾式摘要（tokei 的 Wrapped）。纯本地派生，不需要额外存储。
 */
function wrapped(rollup, summary) {
  const days = Object.keys(rollup?.days ?? {}).sort();
  const activeDays = days.length;
  const peakHour = summary.hours.reduce(
    (best, value, hour) => (value > summary.hours[best] ? hour : best),
    0,
  );
  const topModel = Object.entries(summary.byModel)
    .map(([model, bucket]) => [model, billable(bucket)])
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topProject = Object.entries(summary.byProject)
    .map(([project, bucket]) => [project, billable(bucket)])
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // 连续活跃天数：从今天（或最后一个有数据的日子）往前数不断档的天数。
  let streak = 0;
  const daySet = new Set(days);
  const cursor = new Date();
  for (let i = 0; i < 400; i++) {
    const probe = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - i);
    const month = String(probe.getMonth() + 1).padStart(2, '0');
    const date = String(probe.getDate()).padStart(2, '0');
    const key = `${probe.getFullYear()}-${month}-${date}`;
    if (daySet.has(key)) streak++;
    else if (i > 0) break;
  }

  return {
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
    activeDays,
    peakHour,
    topModel,
    topProject,
    streak,
  };
}

function buildSummary(query) {
  const rollup = loadRollup();
  if (!rollup) return { empty: true };
  if (rollup.stale) return { empty: true, stale: true };

  const settings = loadSettings();
  const range = RANGES.includes(query.get('range')) ? query.get('range') : 'today';
  const source = query.get('source') || null;
  const model = query.get('model') || null;
  const project = query.get('project') || null;

  const summary = summarize(rollup, range, {
    source, model, project,
    // 成本始终计算，是否展示由前端按设置决定——这样切开关不用重新请求。
    priceBucket: costOf,
  });

  const from = rangeStartEpoch(range);
  const sessionList = Object.entries(rollup.sessions ?? {})
    .filter(([src]) => !source || src === source)
    .flatMap(([, list]) => list)
    .filter((s) => !project || s.project === project);
  const sessions = summarizeSessions(sessionList, { from });

  // 覆盖率：能精确计价的 token 占比（vibecafe.ai/usage 的 coverage 指标）。
  // 比「有 X token 未计价」更好读，也更容易看出价格表缺口有多大。
  const coverage = summary.throughput > 0
    ? 1 - (summary.unpricedTokens / summary.throughput)
    : 1;
  const collection = rollup.collection ?? {
    complete: false, scannedAt: null, deferredFiles: null, sources: {},
  };

  return {
    range,
    filters: { source, model, project },
    settings,
    summary,
    sessions,
    coverage,
    // 部分索引会以不均匀方式影响今天与历史天，不能据此计算“比平时”。
    baseline: collection.complete ? baseline(rollup) : null,
    dimensions: dimensions(rollup),
    labels: SOURCE_LABELS,
    pricing: pricingMeta(),
    collection,
    projectPaths: rollup.projectPaths ?? {},
    wrapped: wrapped(rollup, summary),
  };
}

function buildAnalytics(query) {
  const rollup = loadRollup();
  if (!rollup) return { empty: true };
  if (rollup.stale) return { empty: true, stale: true };

  const multi = (name) => {
    const values = query.getAll(name).filter(Boolean);
    if (values.length === 0) return null;
    return values.length === 1 ? values[0] : values;
  };
  try {
    const result = queryUsageAnalytics(rollup, {
      range: query.get('range') || '30d',
      from: query.get('from'),
      to: query.get('to'),
      filters: {
        source: multi('source'),
        model: multi('model'),
        project: multi('project'),
      },
      cursor: query.get('cursor'),
      limit: Number(query.get('limit')) || 50,
      priceBucket: costOf,
    });
    // 工具显示名。analytics.js 只认识 rollup，不认识解析器注册表，所以在这里补。
    // 只加不改：dimensions.sources 仍是 id 数组，老客户端不受影响。原生面板要在
    // 区间条上直接显示筛选中的工具，不能再像现在这样显示 `claude-code` 这种裸 id。
    if (result.dimensions) {
      result.dimensions.sourceLabels = Object.fromEntries(
        (result.dimensions.sources ?? []).map((id) => [id, SOURCE_LABELS[id] ?? id]),
      );
    }
    return result;
  } catch (error) {
    return { empty: true, error: error.message };
  }
}

// ---------- 动作清单 ----------

export function loadActions() {
  const files = [
    ['primary', 'design/main-state-actions.json'],
    ['modifier', 'design/activity-modifiers.json'],
    ['interaction', 'design/interaction-actions.json'],
    ['lifecycle', 'design/runtime-lifecycle-actions.json'],
    ['mini', 'design/mini-actions.json'],
  ];
  const actions = [];
  const seen = new Set();

  const walk = (node, group) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, group);
      return;
    }
    if (!node || typeof node !== 'object') return;
    // 别名条目只有 id + mapsTo + source，**没有 name**——
    // 早先要求 name 存在，把别名整条滤掉了，于是 mapsTo 永远读不到。
    if (node.id && (node.name || node.mapsTo)) {
      const key = `${group}:${node.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push({
          group,
          id: node.id,
          name: node.name ?? null,
          source: node.source ?? null,
          durationMs: node.durationMs ?? null,
          mode: node.mode ?? null,
          accessory: node.accessory ?? null,
          action: node.action ?? null,
          trigger: node.trigger ?? node.event ?? null,
          exit: node.exit ?? null,
          variants: node.variants ?? null,
          mapsTo: node.mapsTo ?? null,
          // 分档：同一状态按并发会话数换素材。白名单必须显式列出——
          // 漏了这一行的表现是「契约里配了 tier，运行时永远只播第一档」，
          // 而且没有任何东西会报错。
          tiers: node.tiers ?? null,
          // 位移意图（自发溜达）。白名单漏了它的表现是「宠物走路但不动」。
          drift: node.drift ?? null,
        });
      }
    }
    for (const value of Object.values(node)) walk(value, group);
  };

  for (const [group, relative] of files) {
    const full = join(REPO_ROOT, relative);
    if (!existsSync(full)) continue;
    try {
      walk(JSON.parse(readFileSync(full, 'utf-8')), group);
    } catch {
      // 单个契约文件损坏不应让整个动作清单不可用。
    }
  }
  return actions;
}

/** 角色几何合同，前端用来校验预览与契约一致。 */
function characterContract() {
  try {
    const full = join(REPO_ROOT, 'design/main-state-actions.json');
    return JSON.parse(readFileSync(full, 'utf-8')).characterContract ?? null;
  } catch {
    return null;
  }
}

/** 39 → 8 的 mini 收敛表。读不到就是空表，编排器会把每一档都标成 unmapped。 */
export function loadConvergence() {
  try {
    const full = join(REPO_ROOT, 'design/mini-actions.json');
    return JSON.parse(readFileSync(full, 'utf-8')).convergence ?? {};
  } catch {
    return {};
  }
}

// ---------- 打开项目 ----------

const OPENERS = {
  finder: (path) => ['open', ['-R', path]],
  vscode: (path) => ['open', ['-a', 'Visual Studio Code', path]],
  terminal: (path) => ['open', ['-a', 'Terminal', path]],
};

/**
 * 在 Finder / 编辑器 / 终端里打开项目（tokei 的 ProjectTrail 能力）。
 *
 * 安全约束：只接受白名单动作，且路径必须**恰好等于** rollup 里记录过的项目路径。
 * 前端传什么都不直接执行，避免把本地面板变成任意命令执行入口。
 */
function openProject(action, path) {
  const builder = OPENERS[action];
  if (!builder) throw new Error('不支持的打开方式');
  const rollup = loadRollup();
  const known = new Set(Object.values(rollup?.projectPaths ?? {}));
  if (!known.has(path)) throw new Error('未知项目路径');
  const [command, args] = builder(path);
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, (err) => (err ? reject(err) : resolvePromise()));
  });
}

// ---------- 服务 ----------

export function createUsageServer({
  collector = null,
  quotaCollector = null,
  cursorQuotaCollector = null,
  grokQuotaCollector = null,
  workBuddyQuotaCollector = null,
  identity = createRuntimeIdentity(),
} = {}) {
  // 面板不该要求用户手动点刷新，所以服务端自带后台采集循环。
  const worker = collector ?? createCollector();
  const quotaWorker = quotaCollector ?? createCodexQuotaCollector();
  const cursorQuotaWorker = cursorQuotaCollector ?? createCursorQuotaCollector();
  const grokQuotaWorker = grokQuotaCollector ?? createGrokQuotaCollector();
  const workBuddyQuotaWorker = workBuddyQuotaCollector ?? createWorkBuddyQuotaCollector();

  // 状态引擎 + 编排器：目前只有「速率推断」这条降级路径在喂它，
  // hook 通道接上后同一个引擎直接消费 hook 事件，不需要改结构。
  // 动作覆盖：记真实使用中每个动作上过屏几次、多久。
  // 可达性测试只能证明「合成场景下能上屏」，证明不了「日常里会上屏」——
  // 一个动作可能完全可达，却因为触发条件在日常里不出现、或每次只闪几十毫秒，
  // 事实上从没被看见过。那种情况没有任何测试会红，也没有人会注意到。
  const coverage = createCoverage(readJson(COVERAGE_FILE, {}) ?? {});
  const engine = createStateEngine({
    onChange: (state) => coverage.observe(state.actionId, Date.now()),
  });
  /**
   * JSONL 兜底通道：hook 没开时，实时会话仍然看得见。
   *
   * **让位是按 agent 分别算的。** 同一台机器上完全可能只连了 Codex 而没连
   * Claude Code——用一个全局时间戳的话，Codex 的 hook 一活跃就会把
   * Claude Code 的兜底一起哑掉，而那正是它唯一的可见性来源。
   *
   * 只在 hook 沉默超过 15 秒后才接手。hook 是权威通道：它带 pid（点击跳回
   * 终端）、带权限请求，事件也更准；两条路同时喂同一个会话会打架。
   */
  const HOOK_PRIORITY_MS = 15_000;
  const lastHookAt = new Map();
  const observeFallback = (event) => {
    // 读本机日志由「记录 token 用量」统一授权。用户关掉它就是说「别读我的
    // 日志」，那 transcript 也一样不能读——只让用量守这条线、实时通道绕过去，
    // 是把同一个承诺执行了一半。
    if (!usageEnabled()) return;
    if (Date.now() - (lastHookAt.get(event.agentId) ?? 0) <= HOOK_PRIORITY_MS) return;
    engine.observeEvent(event, Date.now());
  };
  const stopSessionMonitors = [
    createCodexSessionMonitor({ onEvent: observeFallback }),
    createClaudeSessionMonitor({ agentId: 'claude-code', onEvent: observeFallback }),
    createClaudeSessionMonitor({ agentId: 'workbuddy', onEvent: observeFallback }),
  ];
  // 桌宠没开的那段时间里，hook 写的租约是唯一留下的痕迹。启动时读回来，
  // 免得一个任务跑到一半时桌宠从 idle 开始演。
  // 失败不能挡住启动——租约是尽力而为的增强，不是必要条件。
  try {
    engine.restore(readLeases());
  } catch {
    // 磁盘上的东西坏了就当没有，照常从 idle 起步
  }

  // hook 掉了就补回去。不看着的话，settings.json 被别的工具覆盖之后
  // 桌宠会永远停在 idle——而「没有事件」和「一切正常但很闲」在我们这边
  // 长得一模一样，用户只会觉得「它坏了」，没有任何线索指向原因。
  let hookHealth = { action: 'healthy' };
  const stopHookWatch = watchHooks({ onResult: (r) => { hookHealth = r; } });
  // 落盘节流：状态变化很频繁，每次都写会把一个诊断功能变成 IO 负担。
  let coverageSavedAt = 0;
  const COVERAGE_SAVE_MS = 60_000;
  function persistCoverage(now, force = false) {
    if (!coverage.dirty && !force) return;
    if (!force && now - coverageSavedAt < COVERAGE_SAVE_MS) return;
    const snap = coverage.snapshot(now);
    writeJson(COVERAGE_FILE, { ...snap, since: snap.since ?? now });
    coverage.markClean();
    coverageSavedAt = now;
  }
  const orchestrator = createOrchestrator({
    actions: loadActions(),
    convergence: loadConvergence(),
    contract: characterContract(),
  });
  // 贴边收起时切到 mini 尺寸档。这是**尺寸模式**不是状态——
  // 状态引擎照常产出 39 档之一，由编排器投影到 8 档 mini。
  let miniMode = false;
  // 收起 / 展开的转场。同样放在这一层而不是状态引擎的 oneshot 里：
  // 引擎关心「Claude 在做什么」，窗口多大是外壳的事。混在一起会让
  // 引擎的仲裁表冒出不属于任何会话的条目，把最该说清的东西弄浑。
  let miniTransition = null; // { id, until }

  function beginMiniTransition(id, now) {
    const p = orchestrator.plan(id);
    miniTransition = { id, until: now + (p?.durationMs ?? 1600) };
  }

  /** 契约要求主形态与 mini 之间不允许瞬切——那看起来像闪烁的 bug。 */
  function setMiniMode(wantMini, now) {
    if (wantMini === miniMode && !miniTransition) return;
    if (wantMini) {
      miniMode = true;
      beginMiniTransition('mini.enter', now);
    } else {
      // 先播完展开转场才真正离开 mini，所以这里不动 miniMode。
      beginMiniTransition('mini.exit', now);
    }
  }
  const permissions = createPermissionBroker();
  // 配对链接要带端口，服务启动后回填。
  let currentPort = 4173;

  /**
   * 画面版本 + 长轮询。
   *
   * **为什么要改。** 引擎内部换状态只要 2ms，而外壳每 2 秒才拉一次，
   * 于是用户看到的延迟是 0～2000ms（平均 1 秒）。点一下桌宠要等一秒才
   * 有反应，那读起来就是「卡」——不是动画慢，是消息根本还没送到。
   *
   * 拉模式下这个数字只能靠加密轮询来降，代价是空闲时也在空转。
   * 长轮询把方向反过来：请求挂在服务端等，状态一变立刻返回。
   * 结果是**又快又省**——变化时 ~1ms 送达，不变时 25 秒才一个请求，
   * 比原来的每 2 秒一次还少。
   */
  let planVersion = 0;
  let planSignature = null;
  const waiters = new Set();

  /** 画面上真正能看出区别的东西。只有它变了才叫「变了」。 */
  function signatureOf(snapshot) {
    const p = snapshot.plan;
    return [
      snapshot.state?.actionId, snapshot.state?.variant, snapshot.mini,
      p?.source, p?.name, p?.mode, p?.motion,
      // 几何随动作走，但 mini 档下为 null，单独带上免得漏掉切档
      p?.geometry?.hit?.x0, snapshot.focus?.pid,
    ].join('|');
  }

  function publish(snapshot) {
    const signature = signatureOf(snapshot);
    if (signature === planSignature) return snapshot;
    planSignature = signature;
    planVersion += 1;
    for (const resolve of waiters) resolve();
    waiters.clear();
    return snapshot;
  }

  /**
   * 服务端自己推进时钟。
   *
   * 以前引擎只在**有人来问**的时候才 tick，所以静默链、一次性动作到期
   * 这些「没有外部事件也该发生」的转场，全都被外壳的轮询节奏卡着。
   * 现在服务端自己走，外壳只负责取。
   */
  const TICK_MS = 100;
  const ticker = setInterval(() => {
    try {
      publish(currentPlan());
    } catch {
      // 单次失败不该把定时器带走
    }
  }, TICK_MS);
  ticker.unref?.();

  /** 等到画面版本超过 since，或者超时。 */
  function waitForChange(since, timeoutMs) {
    if (planVersion > since) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      timer.unref?.();
      waiters.add(done);
    });
  }

  /**
   * 体力重算的节流窗口。
   *
   * 体力是从**当天累计**推出来的，几秒之内不可能有肉眼可见的变化；
   * 而算它要解析 168KB 的 rollup.json（实测每次 0.6ms）。
   * 状态推进以前和它绑在一起，所以 currentPlan 的调用频率被这笔开销
   * 压在 2 秒——那 2 秒正是「状态切换延迟很严重」的全部来源。
   * 拆开之后，推进可以跑到 100ms 级，而这笔账还是几秒一次。
   */
  const ENERGY_REFRESH_MS = 5_000;
  let energyAt = 0;

  function currentPlan() {
    const settings = loadSettings();
    const live = worker.live();
    const now = Date.now();

    // 体力：与面板显示的公式一致；关掉 petEnergy 时恒为 1。
    if (now - energyAt >= ENERGY_REFRESH_MS) {
      energyAt = now;
      if (settings.petEnergy) {
        const rollup = loadRollup();
        if (rollup && !rollup.stale) {
          const today = summarize(rollup, 'today', {});
          engine.setEnergy(energyFrom(today.throughput, baseline(rollup)));
        }
      } else {
        engine.setEnergy(1);
      }
    }

    // Codex GUI/CLI 的 rollout JSONL 已由 createCodexSessionMonitor 转成可靠的
    // task_started / tool / task_complete 生命周期事件。不能再把 Codex 近 5 分钟
    // Token 速率当作「现在正在工作」：任务结束后窗口仍为正数，会造出
    // 一个每 100ms 刷新的 rate:working 幽灵会话，反过来压住真实 GUI 状态。
    //
    // 其他尚无事件通道的工具继续使用速率降级。老 collector/mock 没有
    // 分源字段时保持旧行为，避免升级期间把所有降级检测一刀切掉。
    const bySource = live.tokensPerMinBySource;
    const inferredRate = bySource && typeof bySource === 'object'
      ? Object.entries(bySource).reduce((sum, [source, value]) => (
        source === 'codex' ? sum : sum + (Number(value) || 0)
      ), 0)
      : live.tokensPerMin;
    engine.observeRate(live.disabled ? 0 : inferredRate, now);
    const state = engine.tick(now);
    persistCoverage(now);

    // 转场进行中：直接播转场，绕过收敛。播完 mini.exit 才真正回到主形态。
    if (miniTransition) {
      if (now < miniTransition.until) {
        return {
          state,
          plan: orchestrator.plan(miniTransition.id, { reduced: settings.reducedMotion }),
          mini: true,
          energyEnabled: settings.petEnergy,
          debug: engine.debug(),
        };
      }
      if (miniTransition.id === 'mini.exit') miniMode = false;
      miniTransition = null;
    }

    const plan = orchestrator.plan(state.actionId, {
      variant: state.variant,
      reduced: settings.reducedMotion,
      mini: miniMode,
      // 并发会话数决定播第几档。引擎实时算，编排器只负责挑素材——
      // 状态 id 始终不变，分档是渲染层的事。
      busy: state.busy,
    });
    return {
      state, plan, mini: miniMode, energyEnabled: settings.petEnergy, debug: engine.debug(),
      // 当前这个状态是谁发起的。外壳据此实现「点桌宠跳回那个终端」——
      // needs_owner 亮着却没法一键过去，等于只提醒不解决。
      focus: state.focus ?? null,
    };
  }

  const server = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      sendJson(res, 400, { error: '无效请求' });
      return;
    }
    const { pathname } = url;

    try {
      // 局域网镜像的门禁。本机永远放行；局域网需要令牌且只读。
      const settings = loadSettings();
      const gate = authorize({
        remoteAddress: req.socket.remoteAddress,
        pathname,
        method: req.method,
        token: url.searchParams.get('t') || req.headers['x-maclawd-token'],
        lanEnabled: settings.lanMirror === true,
      });
      if (!gate.allow) {
        sendJson(res, 403, { error: gate.reason });
        return;
      }

      // ---- API ----
      if (pathname === '/api/summary') {
        sendJson(res, 200, buildSummary(url.searchParams));
        return;
      }

      if (pathname === '/api/analytics') {
        sendJson(res, 200, buildAnalytics(url.searchParams));
        return;
      }

      if (pathname === '/api/live') {
        // 读后台循环的最新快照，不在请求线程里做磁盘 IO。
        const live = worker.live();
        // 但开关状态必须直接读设置：快照要等下一拍才更新，而用户刚拨了开关就
        // 期待界面立刻承认「已关闭」。让界面显示滞后的开关状态就是不诚实。
        const off = !usageEnabled();
        sendJson(res, 200, {
          tokensPerMin: off ? 0 : live.tokensPerMin,
          intensity: off ? 0 : intensityFromRate(live.tokensPerMin),
          sources: off ? [] : live.sources,
          trackedFiles: off ? 0 : live.trackedFiles,
          disabled: off,
          updatedAt: live.updatedAt,
        });
        return;
      }

      if (pathname === '/api/state') {
        // `?since=N` 进长轮询：挂在这里等画面真的变了再返回。
        // 不带 since 的老行为原样保留——面板、测试、curl 都还是立刻拿到快照。
        const since = Number(url.searchParams.get('since'));
        if (Number.isFinite(since) && since >= 0) {
          // 25 秒是取舍：长到空闲时几乎不产生请求，又短到能穿过
          // 大多数中间层的空闲超时（我们只走回环，但 URLSession 自己也有超时）。
          await waitForChange(since, 25_000);
        }
        sendJson(res, 200, { ...publish(currentPlan()), version: planVersion });
        return;
      }

      if (pathname === '/api/sessions') {
        const sessions = engine.sessions().map((session) => ({
          id: session.id,
          sessionId: session.externalId,
          agentId: session.agentId ?? 'unknown',
          agentLabel: sessionAgentLabel(session.agentId, SOURCE_LABELS[session.agentId]),
          channel: session.channel,
          state: session.state,
          stateLabel: sessionStateLabel(session.state, session.variant),
          statePriority: sessionStatePriority(session.state),
          project: session.cwd ? basename(session.cwd) : '',
          projectPath: session.cwd ? normalize(session.cwd) : '',
          pid: session.pid,
          at: session.at,
          stateSince: session.stateSince,
          subagents: session.subagents,
          winner: session.winner,
        }));
        sendJson(res, 200, { sessions, updatedAt: Date.now() });
        return;
      }

      if (pathname === '/api/agents') {
        if (req.method === 'POST') {
          const { agentId, action } = JSON.parse((await readBody(req)) || '{}');
          if (!['install', 'repair', 'uninstall'].includes(action)
            || !supportsAgentIntegration(agentId)) {
            sendJson(res, 400, { error: '未知 Agent 或操作' });
            return;
          }
          try {
            changeAgentIntegration(agentId, action, { port: currentPort });
          } catch (error) {
            const current = loadSettings();
            sendJson(res, 200, {
              agents: agentConnections(), doctor: runAgentDoctor(current), error: error.message,
            });
            return;
          }
        }
        const current = loadSettings();
        sendJson(res, 200, { agents: agentConnections(), doctor: runAgentDoctor(current) });
        return;
      }

      if (pathname === '/api/event' && req.method === 'POST') {
        // hook 写入器将来往这里投事件；现在先让面板可以手动触发以验证状态机。
        const event = JSON.parse((await readBody(req)) || '{}');
        // 记下这个 agent 的 hook 最近什么时候说过话，兜底通道据此让位。
        if (event.channel === 'hook' && event.agentId) lastHookAt.set(event.agentId, Date.now());
        // 尺寸模式不经过状态引擎——见 setMiniMode 上方的说明。
        if (event.type === 'shell.miniEnter' || event.type === 'shell.miniExit') {
          setMiniMode(event.type === 'shell.miniEnter', Date.now());
        } else {
          engine.observeEvent(event, Date.now());
        }
        // 响应体就是新画面。外壳直接用它渲染，交互反馈是**当场**的，
        // 不用再等下一次轮询——「点一下要等一秒才动」就是这么来的。
        sendJson(res, 200, { ...publish(currentPlan()), version: planVersion });
        return;
      }

      // Claude Code 的 http hook 打进来并等待决策。
      if (pathname === '/api/permission' && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req)) || '{}');
        const agentId = url.searchParams.get('agent') === 'codex' ? 'codex' : 'claude-code';
        if (!loadSettings().permissionBubble) {
          // 通道关闭：立刻交回，绝不让 agent 干等。
          sendJson(res, 200, decisionResponse(null, agentId));
          return;
        }
        engine.observeEvent({
          type: 'PermissionRequest',
          sessionId: payload.session_id ?? 'default',
          agentId,
        }, Date.now());
        const decision = await permissions.request(payload, { agentId });
        engine.observeEvent({
          type: 'PermissionResolved',
          sessionId: payload.session_id ?? 'default',
          agentId,
          resolution: decision ?? 'timeout',
        }, Date.now());
        sendJson(res, 200, decisionResponse(decision, agentId));
        return;
      }

      if (pathname === '/api/permissions') {
        if (req.method === 'POST') {
          const { id, decision } = JSON.parse((await readBody(req)) || '{}');
          sendJson(res, 200, { ok: permissions.decide(id, decision) });
          return;
        }
        sendJson(res, 200, { pending: permissions.list(), enabled: loadSettings().permissionBubble });
        return;
      }

      if (pathname === '/api/lan') {
        if (req.method === 'POST') {
          const { action } = JSON.parse((await readBody(req)) || '{}');
          const token = action === 'reset' ? resetToken()
            : action === 'rotate' ? rotateToken()
              : currentToken();
          sendJson(res, 200, { token, urls: pairingUrls(currentPort) });
          return;
        }
        sendJson(res, 200, {
          enabled: loadSettings().lanMirror === true,
          token: currentToken(),
          urls: pairingUrls(currentPort),
        });
        return;
      }

      if (pathname === '/api/hooks') {
        if (req.method === 'POST') {
          const { action } = JSON.parse((await readBody(req)) || '{}');
          if (action === 'install') { sendJson(res, 200, installHooks()); return; }
          if (action === 'uninstall') { sendJson(res, 200, uninstallHooks()); return; }
          sendJson(res, 400, { error: '未知操作' });
          return;
        }
        sendJson(res, 200, {
          ...hookStatus(),
          permission: permissionHookStatus(),
          // 自愈的最近一次结论。面板要能看见「修过一次」与「修不好了」——
          // 静默自愈和静默失效一样难查。
          health: hookHealth,
        });
        return;
      }

      /**
       * 订阅额度。
       *
       * POST 来自 hooks/maclawd-statusline.js（只可能是本机——lan.js 的
       * authorize 把局域网的一切非 GET 请求都挡在外面了）。
       * GET 给面板、菜单栏和手机镜像读。
       */
      if (pathname === '/api/quota') {
        if (req.method === 'POST') {
          // 主开关关掉时连收都不收。用户关的是「记录这件事」，
          // 那就不该有新数据继续落盘。
          const settings = loadSettings();
          if (!usageEnabled(settings) || settings.quotaTracking !== true) {
            sendJson(res, 200, { ignored: true });
            return;
          }
          const report = JSON.parse((await readBody(req)) || '{}');
          const snapshot = recordQuota(report);
          sendJson(res, 200, snapshot ?? readQuota());
          return;
        }
        // 打开额度页时触发一次带缓存的 Codex 刷新。不阻塞本次响应，
        // 成功后原生面板下一轮轻量轮询就会拿到。
        void quotaWorker.refresh().catch(() => {});
        void cursorQuotaWorker.refresh().catch(() => {});
        void grokQuotaWorker.refresh().catch(() => {});
        void workBuddyQuotaWorker.refresh().catch(() => {});
        const settings = loadSettings();
        const snapshot = readQuota();
        sendJson(res, 200, {
          ...snapshot,
          // 面板要能区分「没装通道」和「装了但还没数据」——
          // 这两种情况的文案完全不同。
          statusline: statuslineStatus(),
          enabled: settings.quotaTracking === true,
          cursor: cursorQuotaWorker.status(),
          grok: grokQuotaWorker.status(),
          workBuddy: workBuddyQuotaWorker.status(),
          alert: {
            enabled: settings.quotaAlert === true,
            threshold: settings.quotaAlertThreshold,
          },
        });
        return;
      }

      /**
       * 待弹的额度提醒。外壳每次轮询顺带问一次；拿到就弹，弹完回 POST 确认。
       *
       * 判定留在 Node 侧而不是 Swift 侧，是为了让「按 resetAt 每周期一次」
       * 只有一份实现——两份去重逻辑必然漂移，而漂移的表现是重复打扰用户。
       */
      if (pathname === '/api/quota/alerts') {
        const settings = loadSettings();
        if (req.method === 'POST') {
          const { acknowledged } = JSON.parse((await readBody(req)) || '{}');
          markAlerted(Array.isArray(acknowledged) ? acknowledged : []);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (!settings.quotaAlert || !usageEnabled()) {
          sendJson(res, 200, { alerts: [] });
          return;
        }
        sendJson(res, 200, {
          alerts: pendingAlerts({ threshold: Number(settings.quotaAlertThreshold) || 85 }),
        });
        return;
      }

      if (pathname === '/api/status') {
        sendJson(res, 200, worker.status());
        return;
      }

      // 身份探针：端口被占时用来分辨「占位的是另一个 Maclawd」还是「别人」。
      // 刻意做成最轻的一条路由——它会被启动路径同步等待。
      if (pathname === '/api/ping') {
        sendJson(res, 200, {
          maclawd: true,
          ...publicRuntimeIdentity(identity),
          pid: process.pid,
          port: currentPort,
        });
        return;
      }

      if (pathname === '/api/runtime/shutdown' && req.method === 'POST') {
        const candidate = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
        if (!managementTokenMatches(identity, candidate)) {
          sendJson(res, 403, { error: '管理令牌无效' });
          return;
        }
        sendJson(res, 202, { accepted: true, instanceId: identity.instanceId });
        setImmediate(shutdownRuntime);
        return;
      }

      /**
       * Offboarding：一键移除 Maclawd 写进别的工具的全部配置。
       * 见 offboard.js 的规则说明。设置开关在里面同步关闭，
       * 面板拿到返回后重读设置即可对齐。
       */
      if (pathname === '/api/offboard' && req.method === 'POST') {
        sendJson(res, 200, offboard());
        return;
      }

      /**
       * 新外壳接管一个还活着的运行时（.reuse）之后认领它。
       *
       * 认领把管理者看护指向新外壳。不认领的话，父进程已死的运行时会在
       * 宽限期结束后自行收摊——把刚接上的外壳晾在一个死端口上。
       * CLI 直跑的运行时没有管理者概念，adopt 会被拒绝（adopted: false），
       * 那不是错误：它的生死属于终端里的用户。
       */
      if (pathname === '/api/runtime/adopt' && req.method === 'POST') {
        const candidate = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
        if (!managementTokenMatches(identity, candidate)) {
          sendJson(res, 403, { error: '管理令牌无效' });
          return;
        }
        const { pid } = JSON.parse((await readBody(req)) || '{}');
        sendJson(res, 200, {
          adopted: managerWatch.adopt(pid),
          instanceId: identity.instanceId,
        });
        return;
      }

      if (pathname === '/api/coverage') {
        const now = Date.now();
        persistCoverage(now, true);
        const known = loadActions().filter((a) => a.name).map((a) => a.id);
        sendJson(res, 200, {
          ...classify(coverage.snapshot(now), known),
          since: readJson(COVERAGE_FILE, {})?.since ?? null,
        });
        return;
      }

      if (pathname === '/api/actions') {
        sendJson(res, 200, { actions: loadActions(), contract: characterContract() });
        return;
      }

      if (pathname === '/api/tools') {
        sendJson(res, 200, {
          tools: parsers.map((p) => ({
            id: p.id,
            label: p.label,
            dirs: p.dataDirs(),
            installed: p.dataDirs().some((d) => existsSync(d)),
          })),
        });
        return;
      }

      if (pathname === '/api/settings') {
        if (req.method === 'POST') {
          const patch = JSON.parse((await readBody(req)) || '{}');
          const before = loadSettings();
          let next = saveSettings(patch);
          const effects = [];
          const quotaTrackingChanged = next.quotaTracking !== before.quotaTracking;

          // 开关必须真的做事。此前 hookEnhancement 只是存了个布尔值，
          // 真正干活的是旁边一个独立按钮——那种开关是在骗用户。
          try {
            if (next.hookEnhancement !== before.hookEnhancement) {
              if (next.hookEnhancement) {
                const r = installHooks();
                effects.push(`已安装 ${r.installed.length + r.alreadyInstalled.length} 个状态事件`);
              } else {
                const r = uninstallHooks();
                effects.push(`已移除 ${r.removed.length} 个状态事件`);
              }
            }
            if (next.codexHookEnhancement !== before.codexHookEnhancement) {
              if (next.codexHookEnhancement) {
                const r = installCodexHooks();
                effects.push(`已安装 ${r.changed.length + r.existing.length} 个 Codex 状态事件`);
              } else {
                const r = uninstallCodexHooks();
                effects.push(`已移除 ${r.existing.length} 个 Codex 状态事件`);
              }
            }
            if (next.workBuddyHookEnhancement !== before.workBuddyHookEnhancement) {
              if (next.workBuddyHookEnhancement) {
                const r = installWorkBuddyHooks();
                effects.push(`已安装 ${r.installed.length + r.alreadyInstalled.length} 个 WorkBuddy 状态事件`);
              } else {
                const r = uninstallWorkBuddyHooks();
                effects.push(`已移除 ${r.removed.length} 个 WorkBuddy 状态事件`);
              }
            }
            if (next.cursorHookEnhancement !== before.cursorHookEnhancement) {
              if (next.cursorHookEnhancement) {
                const r = installCursorHook();
                effects.push(r.installed ? '已安装 Cursor 本地用量 hook' : '已更新 Cursor 本地用量 hook');
              } else {
                const r = uninstallCursorHook();
                effects.push(r.removed ? '已移除 Cursor 本地用量 hook' : 'Cursor 本地用量 hook 未安装');
              }
            }
            if (next.permissionBubble !== before.permissionBubble) {
              if (next.permissionBubble) {
                installPermissionHook({ port: currentPort });
                installCodexPermissionHook();
                effects.push('已注册 Claude Code 与 Codex 权限决策 hook');
              } else {
                uninstallPermissionHook();
                uninstallCodexPermissionHook();
                effects.push('已移除权限决策 hook');
              }
            }
            if (quotaTrackingChanged) {
              if (next.quotaTracking) {
                const r = installStatusline({ autoChainKnown: true });
                if (r.blocked) {
                  next = saveSettings({ quotaTracking: true, quotaStatusline: false });
                  void quotaWorker.refresh({ force: true }).catch(() => {});
                  void cursorQuotaWorker.refresh({ force: true }).catch(() => {});
                  void grokQuotaWorker.refresh({ force: true }).catch(() => {});
                  void workBuddyQuotaWorker.refresh({ force: true }).catch(() => {});
                  sendJson(res, 200, {
                    settings: next,
                    blocked: 'statusline',
                    foreignCommand: r.foreignCommand,
                    error: '已开启 Codex 额度；检测到自定义 Claude 状态行，未覆盖它。',
                  });
                  return;
                }
                next = saveSettings({ quotaTracking: true, quotaStatusline: true });
                effects.push(r.automaticallyCompatible
                  ? '已开启 Codex 额度并与 Claude HUD 自动兼容'
                  : (r.chained ? '已开启 Codex 额度并保留 Claude 状态行' : '已开启 Codex 与 Claude Code 额度'));
                void quotaWorker.refresh({ force: true }).catch(() => {});
                void cursorQuotaWorker.refresh({ force: true }).catch(() => {});
                void grokQuotaWorker.refresh({ force: true }).catch(() => {});
                void workBuddyQuotaWorker.refresh({ force: true }).catch(() => {});
              } else {
                const r = uninstallStatusline();
                next = saveSettings({ quotaTracking: false, quotaStatusline: false });
                effects.push(r.removed
                  ? (r.restored ? '已停止额度读取并还原 Claude 状态行' : '已停止额度读取')
                  : '已停止额度读取');
              }
            }
            // 兼容旧版客户端直接写 quotaStatusline。
            if (!quotaTrackingChanged && next.quotaStatusline !== before.quotaStatusline) {
              if (next.quotaStatusline) {
                // Claude HUD 是已验证的兼容对象：用户只需表达「读取额度」，
                // 串联细节由 Maclawd 自动处理。未知状态行仍保持原来的安全边界，
                // 不经确认绝不修改。
                const r = installStatusline({
                  autoChainKnown: true,
                });
                if (r.blocked) {
                  next = saveSettings({ quotaTracking: false, quotaStatusline: false });
                  sendJson(res, 200, {
                    settings: next,
                    blocked: 'statusline',
                    foreignCommand: r.foreignCommand,
                    error: '检测到你已经配置了状态行，Maclawd 没有覆盖它。',
                  });
                  return;
                }
                effects.push(r.automaticallyCompatible
                  ? '已与 Claude HUD 自动兼容'
                  : (r.chained ? '已串联并保留原有状态行' : '已注册状态行'));
                next = saveSettings({ quotaTracking: true, quotaStatusline: true });
                void grokQuotaWorker.refresh({ force: true }).catch(() => {});
                void cursorQuotaWorker.refresh({ force: true }).catch(() => {});
                void workBuddyQuotaWorker.refresh({ force: true }).catch(() => {});
              } else {
                const r = uninstallStatusline();
                next = saveSettings({ quotaTracking: false, quotaStatusline: false });
                effects.push(r.removed
                  ? (r.restored ? '已移除状态行并还原原有' : '已移除状态行')
                  : '状态行已被改成别的，未改动');
              }
            }
          } catch (err) {
            // External hook files are the source of truth for these toggles. If one
            // write fails, restore both settings and integrations to the prior state
            // instead of leaving a switch that claims a half-installed connection.
            next = saveSettings(before);
            try {
              if (before.hookEnhancement) installHooks(); else uninstallHooks();
              if (before.codexHookEnhancement) installCodexHooks(); else uninstallCodexHooks();
              if (before.workBuddyHookEnhancement) installWorkBuddyHooks();
              else uninstallWorkBuddyHooks();
              if (before.cursorHookEnhancement) installCursorHook();
              else uninstallCursorHook();
              if (before.permissionBubble) {
                installPermissionHook({ port: currentPort });
                installCodexPermissionHook();
              } else {
                uninstallPermissionHook();
                uninstallCodexPermissionHook();
              }
            } catch { /* Doctor will surface an external file that remains unreadable. */ }
            sendJson(res, 200, { settings: next, error: err.message });
            return;
          }
          sendJson(res, 200, { settings: next, effects });
          return;
        }
        sendJson(res, 200, { settings: loadSettings() });
        return;
      }

      if (pathname === '/api/scan' && req.method === 'POST') {
        if (worker.status().scanning) {
          sendJson(res, 409, { error: '扫描进行中' });
          return;
        }
        // 用户主动点击视为一次显式授权，force 绕过主开关只此一次。
        const result = await worker.scanNow({ force: true });
        sendJson(res, 200, result ?? { error: '扫描进行中' });
        return;
      }

      // Cursor stop hook 只需要“告诉运行时有新数据”，不能为了等一次完整扫描
      // 把 Agent 的退出阶段卡住。先立即确认，再在后台刷新今日汇总。
      if (pathname === '/api/scan/kick' && req.method === 'POST') {
        sendJson(res, 202, { accepted: true });
        if (typeof worker.requestScan === 'function') {
          worker.requestScan();
        } else if (!worker.status().scanning) {
          queueMicrotask(() => { void Promise.resolve(worker.scanNow()).catch(() => {}); });
        }
        return;
      }

      if (pathname === '/api/update-prices' && req.method === 'POST') {
        // 本项目唯一的对外请求，必须由用户显式触发，绝不在启动时自动发起。
        const result = await updatePrices();
        sendJson(res, 200, { ...result, meta: pricingMeta() });
        return;
      }

      if (pathname === '/api/reset' && req.method === 'POST') {
        // 只删派生数据。本机日志不属于 Maclawd，永不触碰；重新扫描即可全量重建。
        // 额度也一起删——「删除全部用量记录」如果留下额度记录，
        // 用户会以为没删干净。它同样是派生数据，下次刷新就回来。
        for (const name of [ROLLUP_FILE, SCAN_CACHE_FILE, TAIL_STATE_FILE, QUOTA_FILE]) {
          removeJson(name);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      /**
       * 状态行通道的独立管理入口。
       *
       * 设置开关会自动兼容已验证的 Claude HUD。只有未知自定义状态行才需要
       * 通过这里发出一次**显式**串联操作；普通设置请求没有绕过保护的参数。
       */
      if (pathname === '/api/statusline') {
        if (req.method === 'POST') {
          const { action } = JSON.parse((await readBody(req)) || '{}');
          if (action === 'install' || action === 'chain') {
            const r = installStatusline({ chainExisting: action === 'chain' });
            if (r.ok) saveSettings({ quotaTracking: true, quotaStatusline: true });
            sendJson(res, 200, { ...r, status: statuslineStatus() });
            return;
          }
          if (action === 'uninstall') {
            const r = uninstallStatusline();
            saveSettings({ quotaTracking: false, quotaStatusline: false });
            sendJson(res, 200, { ...r, status: statuslineStatus() });
            return;
          }
          sendJson(res, 400, { error: '未知操作' });
          return;
        }
        sendJson(res, 200, statuslineStatus());
        return;
      }

      if (pathname === '/api/open' && req.method === 'POST') {
        const { action, path } = JSON.parse((await readBody(req)) || '{}');
        await openProject(action, path);
        sendJson(res, 200, { ok: true });
        return;
      }

      // ---- 静态 ----
      const target = pathname === '/' ? '/pet.html'
        : pathname === '/usage' ? '/usage.html'
          : pathname === '/mobile' ? '/mobile.html'
            : pathname;
      const file = resolveStatic(target);
      if (!file) {
        sendJson(res, 404, { error: '未找到' });
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(readFileSync(file));
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address === 'object') currentPort = address.port;
  });

  /**
   * 主动收摊：清端点、停后台工作、放掉长轮询、关服务。
   * /api/runtime/shutdown（新外壳替换旧运行时）与管理者看护（外壳被
   * 强制退出）共用同一条路径——两条实现漂移的话，总有一条会留下
   * 半死的进程或一个指向死端口的端点文件。
   */
  function shutdownRuntime() {
    clearEndpoint({ instanceId: identity.instanceId });
    worker.stop?.();
    for (const resolve of waiters) resolve();
    waiters.clear();
    server.close();
    server.closeIdleConnections?.();
  }

  // 外壳被强制退出时收不到 SIGTERM，孤儿运行时会在后台无限期跑下去，
  // 还占着端点让桌宠无法被 hook 重新拉起。看护管理者：它没了（宽限期
  // 之后）就收摊。端点清掉之后，下一个 agent 会话会拉起完整的应用。
  const managerWatch = createManagerWatch({ onManagerGone: shutdownRuntime });
  managerWatch.start();

  // 看门狗与推进定时器都要随服务一起撤——测试里一个进程会起关好几次服务，
  // 留着的话文件监听和定时器会越堆越多。挂着的长轮询也要放掉，
  // 否则 server.close() 会一直等这些请求，测试卡在关闭那一步。
  server.on('close', () => {
    managerWatch.stop();
    stopHookWatch();
    for (const stop of stopSessionMonitors) stop();
    quotaWorker.stop();
    cursorQuotaWorker.stop();
    grokQuotaWorker.stop();
    workBuddyQuotaWorker.stop();
    clearInterval(ticker);
    for (const resolve of waiters) resolve();
    waiters.clear();
  });

  return { server, worker, quotaWorker, cursorQuotaWorker, grokQuotaWorker, workBuddyQuotaWorker, identity };
}

/** 端口被占时最多往后试几个。够覆盖「同机开了几个 Vite」，又不会无限游走。 */
export const PORT_SCAN_LIMIT = 12;

/** 占住这个端口的是不是另一个 Maclawd。 */
async function probeMaclawd(port, timeoutMs = 400) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.maclawd === true ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 启动本地服务。
 *
 * **端口被占不再是致命的。** 此前这里的 `listen` 没有 error 处理，
 * EADDRINUSE 会以未捕获异常的形式打死整个运行时进程；外壳把 stderr
 * 接到 /dev/null，用户只看到桌宠不动、毫无提示。而 4173 恰好是
 * Vite preview 的默认端口，撞车概率一点都不低。
 *
 * 现在分两种情况：
 *   · 占位的是另一个 Maclawd → 不启动第二份（两个采集器会重复计数），
 *     抛出带 `alreadyRunning` 的错误交给调用方决定。
 *   · 占位的是别人 → 顺次往后找一个空端口。
 *
 * 拿到端口后写端点文件，hook 与外壳靠它找到我们，谁都不用写死常量。
 */
export function serve({ port = 4173, host = null, collector = null } = {}) {
  const {
    server, worker, quotaWorker, cursorQuotaWorker, grokQuotaWorker, workBuddyQuotaWorker, identity,
  } = createUsageServer({ collector });
  // 只有显式开启局域网镜像才监听外部地址；否则严格绑回环。
  const bind = host ?? (loadSettings().lanMirror === true ? '0.0.0.0' : '127.0.0.1');

  return new Promise((resolvePromise, rejectPromise) => {
    let attempt = 0;

    const onError = async (err) => {
      if (err?.code !== 'EADDRINUSE') {
        server.removeListener('error', onError);
        rejectPromise(err);
        return;
      }
      const candidate = port + attempt;
      const other = await probeMaclawd(candidate);
      if (other) {
        server.removeListener('error', onError);
        const conflict = new Error(`Maclawd 已经在 ${candidate} 端口运行（pid ${other.pid ?? '?'}）`);
        conflict.code = 'EALREADYRUNNING';
        conflict.alreadyRunning = other;
        conflict.port = candidate;
        rejectPromise(conflict);
        return;
      }
      attempt += 1;
      if (attempt >= PORT_SCAN_LIMIT) {
        server.removeListener('error', onError);
        const exhausted = new Error(
          `${port}…${port + PORT_SCAN_LIMIT - 1} 全部被占用，无法启动本地服务`,
        );
        exhausted.code = 'EPORTEXHAUSTED';
        rejectPromise(exhausted);
        return;
      }
      server.listen(port + attempt, bind);
    };

    server.on('error', onError);
    server.listen(port, bind, () => {
      server.removeListener('error', onError);
      const actual = server.address()?.port ?? port;
      writeEndpoint({ port: actual, identity });
      // 后台开始采集，页面打开即有数据。
      worker.start().catch(() => {});
      quotaWorker.start();
      cursorQuotaWorker.start();
      grokQuotaWorker.start();
      workBuddyQuotaWorker.start();
      resolvePromise({
        server, worker, quotaWorker, cursorQuotaWorker, grokQuotaWorker, workBuddyQuotaWorker,
        identity, port: actual, host: bind,
      });
    });
  });
}
