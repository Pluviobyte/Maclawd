import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
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
import { intensityFromRate } from './tail.js';
import { createCollector } from './daemon.js';
import { createStateEngine, energyFrom } from './state-engine.js';
import {
  installHooks, uninstallHooks, hookStatus,
  installPermissionHook, uninstallPermissionHook, permissionHookStatus,
} from './hook-install.js';
import { createPermissionBroker, decisionResponse } from './permissions.js';
import { authorize, currentToken, pairingUrls, resetToken, rotateToken } from './lan.js';
import { createOrchestrator } from './orchestrator.js';
import { loadSettings, saveSettings, usageEnabled } from './settings.js';
import { readJson, writeJson, removeJson } from './store.js';
import { COVERAGE_FILE, ROLLUP_FILE, SCAN_CACHE_FILE, TAIL_STATE_FILE } from './paths.js';
import { classify, createCoverage } from './coverage.js';

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

  return {
    range,
    filters: { source, model, project },
    settings,
    summary,
    sessions,
    coverage,
    baseline: baseline(rollup),
    dimensions: dimensions(rollup),
    labels: SOURCE_LABELS,
    pricing: pricingMeta(),
    projectPaths: rollup.projectPaths ?? {},
    wrapped: wrapped(rollup, summary),
  };
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

export function createUsageServer({ collector = null } = {}) {
  // 面板不该要求用户手动点刷新，所以服务端自带后台采集循环。
  const worker = collector ?? createCollector();

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

  function currentPlan() {
    const settings = loadSettings();
    const live = worker.live();
    const now = Date.now();

    // 体力：与面板显示的公式一致；关掉 petEnergy 时恒为 1。
    if (settings.petEnergy) {
      const rollup = loadRollup();
      if (rollup && !rollup.stale) {
        const today = summarize(rollup, 'today', {});
        engine.setEnergy(energyFrom(today.throughput, baseline(rollup)));
      }
    } else {
      engine.setEnergy(1);
    }

    engine.observeRate(live.disabled ? 0 : live.tokensPerMin, now);
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
        sendJson(res, 200, currentPlan());
        return;
      }

      if (pathname === '/api/event' && req.method === 'POST') {
        // hook 写入器将来往这里投事件；现在先让面板可以手动触发以验证状态机。
        const event = JSON.parse((await readBody(req)) || '{}');
        // 尺寸模式不经过状态引擎——见 setMiniMode 上方的说明。
        if (event.type === 'shell.miniEnter' || event.type === 'shell.miniExit') {
          setMiniMode(event.type === 'shell.miniEnter', Date.now());
        } else {
          engine.observeEvent(event, Date.now());
        }
        sendJson(res, 200, currentPlan());
        return;
      }

      // Claude Code 的 http hook 打进来并等待决策。
      if (pathname === '/api/permission' && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req)) || '{}');
        if (!loadSettings().permissionBubble) {
          // 通道关闭：立刻交回，绝不让 agent 干等。
          sendJson(res, 200, decisionResponse(null));
          return;
        }
        engine.observeEvent({
          type: 'PermissionRequest',
          sessionId: payload.session_id ?? 'default',
        }, Date.now());
        const decision = await permissions.request(payload);
        if (decision) {
          engine.observeEvent({
            type: 'PermissionResolved',
            sessionId: payload.session_id ?? 'default',
          }, Date.now());
        }
        sendJson(res, 200, decisionResponse(decision));
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
        sendJson(res, 200, { ...hookStatus(), permission: permissionHookStatus() });
        return;
      }

      if (pathname === '/api/status') {
        sendJson(res, 200, worker.status());
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
          const next = saveSettings(patch);
          const effects = [];

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
            if (next.permissionBubble !== before.permissionBubble) {
              if (next.permissionBubble) {
                installPermissionHook({ port: currentPort });
                effects.push('已注册权限决策 hook');
              } else {
                uninstallPermissionHook();
                effects.push('已移除权限决策 hook');
              }
            }
          } catch (err) {
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

      if (pathname === '/api/update-prices' && req.method === 'POST') {
        // 本项目唯一的对外请求，必须由用户显式触发，绝不在启动时自动发起。
        const result = await updatePrices();
        sendJson(res, 200, { ...result, meta: pricingMeta() });
        return;
      }

      if (pathname === '/api/reset' && req.method === 'POST') {
        // 只删派生数据。本机日志不属于 Maclawd，永不触碰；重新扫描即可全量重建。
        for (const name of [ROLLUP_FILE, SCAN_CACHE_FILE, TAIL_STATE_FILE]) removeJson(name);
        sendJson(res, 200, { ok: true });
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

  return { server, worker };
}

export function serve({ port = 4173, host = null, collector = null } = {}) {
  return new Promise((resolvePromise) => {
    const { server, worker } = createUsageServer({ collector });
    // 只有显式开启局域网镜像才监听外部地址；否则严格绑回环。
    const bind = host ?? (loadSettings().lanMirror === true ? '0.0.0.0' : '127.0.0.1');
    server.listen(port, bind, () => {
      // 后台开始采集，页面打开即有数据。
      worker.start().catch(() => {});
      resolvePromise({ server, worker, port, host: bind });
    });
  });
}
