import { readJson, writeJson, removeJson } from './store.js';

/**
 * 账号级订阅额度。
 *
 * **为什么不挂在会话上。** 会话会来会走（陈旧清扫会驱逐它们，应用会重启），
 * 但「这个账号的订阅用了多少」不是会话属性——头号用例恰恰是
 * **开工之前先看一眼还剩多少**，那时根本没有任何会话存在。
 * 所以按来源（source）存，与 rollup 的会话记录完全分开。
 *
 * **过期的额度不是「旧」，是「错」。** 窗口按墙钟重置，与你干不干活无关。
 * 一条 resetAt 已经过去的记录会一直显示重置前的高位——那是在撒谎，
 * 比没有数据更糟。所以这里把新鲜度做成一等公民：
 *
 * | 状态     | 判据                      | 面板表现            |
 * | -------- | ------------------------- | ------------------- |
 * | live     | 来源的刷新周期内确认过     | 正常                |
 * | quiet    | 超过来源刷新周期没确认     | 标注「N 分钟前」    |
 * | reset    | now > resetAt             | 变灰，不显示百分比  |
 * | （丢弃） | resetAt 过去超过 48 小时  | 直接删掉            |
 *
 * 还要分开记两个时间戳：`updatedAt`（数值上次**变化**）和
 * `lastSeenAt`（上次**确认收到**）。只记前者的话，一个稳定不变的额度
 * 会被误判成失联；只记后者的话，又说不出「这个数字是什么时候变的」。
 */

export const QUOTA_FILE = 'account-quota.json';
export const QUOTA_VERSION = 1;

/** 超过这么久没收到确认就标注「N 分钟前」。 */
export const QUIET_AFTER_MS = 5 * 60 * 1000;
/** Codex 官方读取做十分钟缓存，不能在下一次正常刷新前误标过期。 */
export const CODEX_QUIET_AFTER_MS = 10 * 60 * 1000;
/** WorkBuddy 云端额度十分钟刷新；留五分钟网络抖动余量再标 quiet。 */
export const WORKBUDDY_QUIET_AFTER_MS = 15 * 60 * 1000;
/** 窗口重置这么久之后仍无新报告，记录直接丢弃。 */
export const DROP_AFTER_RESET_MS = 48 * 60 * 60 * 1000;
/** 没有 resetAt 的记录（理论上不该有）靠这个兜底老化。 */
export const DROP_UNSEEN_MS = 48 * 60 * 60 * 1000;

export const WINDOW_LABELS = {
  five_hour: '5 小时',
  seven_day: '本周',
};
/** 面板里的显示顺序。短窗口在前——它才是「现在能不能开大活」的那个。 */
export const WINDOW_ORDER = ['five_hour', 'seven_day'];

function validWindowKey(source, key) {
  if (WINDOW_ORDER.includes(key)) return true;
  if (source === 'workbuddy') return /^(base|bonus)_\d+$/.test(key);
  return (source === 'codex' || source.startsWith('codex:'))
    && (/^duration_\d+$/.test(key) || /^codex_(primary|secondary)$/.test(key));
}

function orderedWindowKeys(source, windows) {
  return Object.keys(windows ?? {})
    .filter((key) => validWindowKey(source, key))
    .sort((a, b) => {
      if (source === 'workbuddy') {
        const [aKind, aIndex] = a.split('_');
        const [bKind, bIndex] = b.split('_');
        const kindOrder = { base: 0, bonus: 1 };
        return (kindOrder[aKind] ?? 2) - (kindOrder[bKind] ?? 2)
          || Number(aIndex) - Number(bIndex);
      }
      const aDuration = num(windows[a]?.durationMinutes);
      const bDuration = num(windows[b]?.durationMinutes);
      if (aDuration !== null || bDuration !== null) {
        return (aDuration ?? Infinity) - (bDuration ?? Infinity);
      }
      return WINDOW_ORDER.indexOf(a) - WINDOW_ORDER.indexOf(b);
    });
}

export const SOURCE_LABELS = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  workbuddy: 'WorkBuddy',
};

function emptyStore() {
  return { version: QUOTA_VERSION, sources: {}, alerted: {} };
}

function loadStore() {
  const raw = readJson(QUOTA_FILE, null);
  if (!raw || typeof raw !== 'object' || raw.version !== QUOTA_VERSION) return emptyStore();
  return {
    version: QUOTA_VERSION,
    sources: (raw.sources && typeof raw.sources === 'object') ? raw.sources : {},
    alerted: (raw.alerted && typeof raw.alerted === 'object') ? raw.alerted : {},
  };
}

/**
 * 只接受**真的是数字**的值。
 *
 * 不能写成 `Number.isFinite(Number(value))`：`Number(null)` 是 `0`，
 * `Number('')` 和 `Number([])` 也是 `0`。而这些值恰恰来自 JSON 里
 * 「这一项暂时没有」的表达——把它们折成 0 就会显示出一个看起来正常的
 * 假数字（「上下文 0%」「已用 0%」），比空着更糟。
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampPercent(value) {
  const n = num(value);
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}

/**
 * 收到一次上报。来自 hooks/maclawd-statusline.js 的 POST /api/quota。
 *
 * 上报是**部分的**：实测会话第一条 payload 没有 rate_limits，
 * 之后每条也可能只带其中一个窗口。所以这里是逐字段合并，
 * 缺失字段保留旧值而不是清空——清空会让面板在两次刷新之间闪一下空白。
 */
export function recordQuota(report, { now = Date.now() } = {}) {
  if (!report || typeof report !== 'object') return null;
  const source = typeof report.source === 'string' && report.source.trim()
    ? report.source.trim().slice(0, 64)
    : 'claude-code';

  const store = loadStore();
  const prev = store.sources[source] ?? { windows: {} };
  const next = {
    // Claude 状态行是部分上报，要 merge；Codex RPC 是完整 snapshot，
    // 本次没出现的窗口必须消失，不能继续显示上个周期的旧值。
    windows: report.completeSnapshot === true ? {} : { ...(prev.windows ?? {}) },
    context: prev.context ?? null,
    sessionCostUsd: prev.sessionCostUsd ?? null,
    model: prev.model ?? null,
    version: prev.version ?? null,
    sourceLabel: prev.sourceLabel ?? null,
    planType: prev.planType ?? null,
    lastSeenAt: now,
  };

  const windows = report.windows && typeof report.windows === 'object' ? report.windows : {};
  for (const key of Object.keys(windows)) {
    if (!validWindowKey(source, key)) continue;
    const usedPercent = clampPercent(windows[key]?.usedPercent);
    if (usedPercent === null) continue;
    const resetAt = num(windows[key]?.resetAt);
    const before = next.windows[key];
    // updatedAt 只在数值真的变了才动；lastSeenAt 每次都动。
    const changed = !before
      || before.usedPercent !== usedPercent
      || before.resetAt !== resetAt
      || before.used !== num(windows[key]?.used)
      || before.limit !== num(windows[key]?.limit)
      || before.remaining !== num(windows[key]?.remaining);
    next.windows[key] = {
      usedPercent,
      resetAt,
      used: num(windows[key]?.used),
      limit: num(windows[key]?.limit),
      remaining: num(windows[key]?.remaining),
      kind: ['base', 'bonus'].includes(windows[key]?.kind) ? windows[key].kind : null,
      label: typeof windows[key]?.label === 'string'
        ? windows[key].label.trim().slice(0, 48) : (before?.label ?? null),
      durationMinutes: num(windows[key]?.durationMinutes) ?? before?.durationMinutes ?? null,
      updatedAt: changed ? now : (before?.updatedAt ?? now),
      lastSeenAt: now,
    };
  }

  if (report.context && typeof report.context === 'object') {
    const usedPercent = clampPercent(report.context.usedPercent);
    if (usedPercent !== null) {
      next.context = {
        usedPercent,
        windowSize: num(report.context.windowSize),
        lastSeenAt: now,
      };
    }
  }

  const cost = num(report.sessionCostUsd);
  if (cost !== null) next.sessionCostUsd = cost;
  if (typeof report.model === 'string') next.model = report.model;
  if (typeof report.version === 'string') next.version = report.version;
  if (typeof report.sourceLabel === 'string' && report.sourceLabel.trim()) {
    next.sourceLabel = report.sourceLabel.trim().slice(0, 96);
  }
  if (typeof report.planType === 'string') next.planType = report.planType.slice(0, 32);

  store.sources[source] = next;
  persist(prune(store, now));
  return readQuota({ now });
}

/** 丢弃已经不可能再有意义的记录。见文件头的表格最后一行。 */
function prune(store, now) {
  for (const source of Object.keys(store.sources)) {
    const entry = store.sources[source];
    const windows = entry?.windows ?? {};
    for (const key of Object.keys(windows)) {
      const w = windows[key];
      const resetAt = num(w?.resetAt);
      const lastSeenAt = num(w?.lastSeenAt) ?? 0;
      const expiredLongAgo = resetAt !== null && now - resetAt > DROP_AFTER_RESET_MS;
      // 没有 resetAt 的记录永远不会「过期」，只能靠没人确认来老化，
      // 否则它会一直挂在面板上。
      const neverConfirmed = resetAt === null && now - lastSeenAt > DROP_UNSEEN_MS;
      if (expiredLongAgo || neverConfirmed) delete windows[key];
    }
    if (Object.keys(windows).length === 0 && !entry?.context) delete store.sources[source];
  }
  // 提醒去重键按 resetAt 记；那个时刻过去之后这条键永远不会再被查到。
  for (const key of Object.keys(store.alerted)) {
    const resetAt = num(store.alerted[key]?.resetAt);
    if (resetAt === null || now > resetAt) delete store.alerted[key];
  }
  return store;
}

function persist(store) {
  writeJson(QUOTA_FILE, store);
}

/** 一个窗口现在处于哪一档。 */
export function freshness(window, now = Date.now(), source = null) {
  const resetAt = num(window?.resetAt);
  if (resetAt !== null && now > resetAt) return 'reset';
  const lastSeenAt = num(window?.lastSeenAt) ?? 0;
  const quietAfter = source === 'codex' ? CODEX_QUIET_AFTER_MS
    : source === 'workbuddy' ? WORKBUDDY_QUIET_AFTER_MS : QUIET_AFTER_MS;
  return now - lastSeenAt > quietAfter ? 'quiet' : 'live';
}

/**
 * 面板/菜单栏读的快照。已经把新鲜度算好了，消费方不需要再懂规则。
 */
export function readQuota({ now = Date.now() } = {}) {
  const store = prune(loadStore(), now);
  const sources = [];

  for (const id of Object.keys(store.sources)) {
    const entry = store.sources[id];
    const windows = [];
    for (const key of orderedWindowKeys(id, entry?.windows)) {
      const w = entry?.windows?.[key];
      if (!w) continue;
      const state = freshness(w, now, id);
      windows.push({
        id: key,
        label: w.label ?? WINDOW_LABELS[key] ?? key,
        // 已重置的窗口不给百分比——那个数字是重置前的，已经不成立了。
        usedPercent: state === 'reset' ? null : w.usedPercent,
        used: state === 'reset' ? null : (w.used ?? null),
        limit: state === 'reset' ? null : (w.limit ?? null),
        remaining: state === 'reset' ? null : (w.remaining ?? null),
        kind: w.kind ?? null,
        resetAt: w.resetAt ?? null,
        state,
        updatedAt: w.updatedAt ?? null,
        lastSeenAt: w.lastSeenAt ?? null,
        staleSeconds: Math.max(0, Math.round((now - (w.lastSeenAt ?? now)) / 1000)),
      });
    }
    if (windows.length === 0 && !entry?.context) continue;
    sources.push({
      id,
      label: entry?.sourceLabel ?? SOURCE_LABELS[id] ?? id,
      windows,
      context: entry?.context ?? null,
      sessionCostUsd: entry?.sessionCostUsd ?? null,
      model: entry?.model ?? null,
      planType: entry?.planType ?? null,
      lastSeenAt: entry?.lastSeenAt ?? null,
    });
  }

  return { sources, empty: sources.length === 0, now };
}

/**
 * 该不该提醒。
 *
 * **去重键是 resetAt，不是日期。** 5 小时窗口一天有好几个周期，
 * 每个周期都值得提醒一次；用「每天最多一次」会漏掉后面几个周期。
 * 窗口一重置，旧键在 prune 里自然失效，下个周期重新可提醒。
 */
export function pendingAlerts({ threshold = 85, now = Date.now() } = {}) {
  const store = prune(loadStore(), now);
  const out = [];
  for (const id of Object.keys(store.sources)) {
    const entry = store.sources[id];
    for (const key of orderedWindowKeys(id, entry?.windows)) {
      const w = entry?.windows?.[key];
      if (!w) continue;
      if (freshness(w, now, id) === 'reset') continue;
      if (!(w.usedPercent >= threshold)) continue;
      const alertKey = `${id}:${key}:${w.resetAt ?? 0}`;
      if (store.alerted[alertKey]) continue;
      out.push({
        key: alertKey,
        source: id,
        sourceLabel: entry?.sourceLabel ?? SOURCE_LABELS[id] ?? id,
        window: key,
        windowLabel: w.label ?? WINDOW_LABELS[key] ?? key,
        usedPercent: w.usedPercent,
        resetAt: w.resetAt ?? null,
      });
    }
  }
  return out;
}

/** 记下「这个周期已经提醒过了」。 */
export function markAlerted(alerts, { now = Date.now() } = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return;
  const store = loadStore();
  for (const alert of alerts) {
    if (!alert?.key) continue;
    store.alerted[alert.key] = { at: now, resetAt: num(alert.resetAt) };
  }
  persist(prune(store, now));
}

/** 删除全部额度记录。跟着「删除全部用量记录」一起走。 */
export function clearQuota() {
  removeJson(QUOTA_FILE);
}
