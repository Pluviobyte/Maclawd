import { scanAll } from './scan.js';
import { buildRollup } from './rollup.js';
import { createTailer } from './tail.js';
import { statSync } from 'node:fs';
import { readJson, writeJson } from './store.js';
import { ROLLUP_FILE, usagePath } from './paths.js';
import { usageEnabled } from './settings.js';

/**
 * 后台采集循环。见 design/token-tracking.md 三层架构的 B 层。
 *
 * 两条独立节拍，因为职责不同：
 *   tail  1s   只读文件新增字节 → 实时速率，桌宠的强度信号
 *   scan  30m  全量比对 → 日聚合，面板的历史数字
 *
 * 桌宠不可能要求用户手动点「刷新」，所以这个循环是产品的必需件而不是优化。
 *
 * **主开关必须能真正停住它。** 停不住的开关比没有开关更糟——用户以为关了，
 * 实际还在读他的日志。所以每一拍都重新读设置，而不是启动时读一次。
 */

const DEFAULT_TAIL_MS = 1_000;
const DEFAULT_SCAN_MS = 30 * 60 * 1000;
// 冷建索引时每轮仍受 scan.js 的 20 秒预算保护，但不能因此停 30 分钟。
// 留 5 秒让出 CPU / 磁盘，再从持久化断点继续。
const DEFAULT_CATCH_UP_MS = 5_000;

/** scan、daemon 与 CLI 必须用同一份采集完整度语义。 */
export function collectionFromScan(result, scannedAt = new Date().toISOString()) {
  const sourceIncomplete = Object.values(result.sourceStatus ?? {})
    .some((source) => !source.complete);
  return {
    complete: !result.indexing && !sourceIncomplete,
    scannedAt,
    deferredFiles: result.stats?.deferred ?? 0,
    sources: result.sourceStatus ?? {},
  };
}

export function createCollector({
  tailIntervalMs = DEFAULT_TAIL_MS,
  scanIntervalMs = DEFAULT_SCAN_MS,
  catchUpIntervalMs = DEFAULT_CATCH_UP_MS,
  scan = scanAll,
  onScan = null,
  onTick = null,
  onError = null,
} = {}) {
  const tailer = createTailer();
  let tailTimer = null;
  let scanTimer = null;
  let reconcileTimer = null;
  let nextScanAt = null;
  let scanning = false;
  let scanRequested = false;
  let requestedForce = false;
  let requestScheduled = false;
  let stopped = true;
  let lifecycle = 0;

  const live = {
    tokensPerMin: 0,
    tokensPerMinBySource: {},
    intensityInput: 0,
    sources: [],
    trackedFiles: 0,
    disabled: false,
    updatedAt: null,
  };
  let lastScan = null;
  let observedRollupMtimeMs = null;
  let persistedBacklog = false;

  function diskHasBacklog({ force = false } = {}) {
    let mtimeMs = null;
    try { mtimeMs = statSync(usagePath(ROLLUP_FILE)).mtimeMs; } catch { return false; }
    if (!force && mtimeMs === observedRollupMtimeMs) return persistedBacklog;
    observedRollupMtimeMs = mtimeMs;
    const collection = readJson(ROLLUP_FILE, null)?.collection;
    // complete=false 也可能只是权限/解析失败，无法靠 5 秒重试推进。只有明确
    // deferred 的时间预算积压才走 catch-up；永久错误保持普通周期。
    const sourceDeferred = Object.values(collection?.sources ?? {})
      .reduce((sum, source) => sum + (source?.deferredFiles ?? 0), 0);
    persistedBacklog = (collection?.deferredFiles ?? sourceDeferred) > 0;
    return persistedBacklog;
  }

  function scheduleScan(delayMs) {
    if (stopped) return;
    if (scanTimer) clearTimeout(scanTimer);
    nextScanAt = Date.now() + delayMs;
    scanTimer = setTimeout(async () => {
      scanTimer = null;
      nextScanAt = null;
      if (!stopped) await runScan();
    }, delayMs);
    scanTimer.unref?.();
  }

  // 独立 CLI 或旧进程可能在本服务运行期间写入一份未完成 rollup。
  // 只看内存里的 lastScan 会误等 30 分钟。每个 catch-up 周期只 stat 一次，
  // mtime 变化时才解析 JSON，并把远期普通扫描提前。
  function scheduleReconciliation() {
    if (stopped) return;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (!stopped && !scanning && diskHasBacklog()) {
        const catchUpAt = Date.now() + catchUpIntervalMs;
        if (!scanTimer || nextScanAt === null || nextScanAt > catchUpAt + 1) {
          scheduleScan(catchUpIntervalMs);
        }
      }
      scheduleReconciliation();
    }, catchUpIntervalMs);
    reconcileTimer.unref?.();
  }

  function scheduleRequestedScan() {
    if (stopped || scanning || requestScheduled || !scanRequested) return;
    requestScheduled = true;
    queueMicrotask(async () => {
      requestScheduled = false;
      if (stopped || scanning || !scanRequested) return;
      const force = requestedForce;
      scanRequested = false;
      requestedForce = false;
      await runScan({ force });
      scheduleRequestedScan();
    });
  }

  function requestScan({ force = false } = {}) {
    if (stopped) return false;
    scanRequested = true;
    requestedForce ||= force;
    scheduleRequestedScan();
    return true;
  }

  async function runScan({ force = false } = {}) {
    if (scanning) return null;
    if (!force && !usageEnabled()) {
      lastScan = { disabled: true, at: new Date().toISOString() };
      scheduleScan(scanIntervalMs);
      return lastScan;
    }
    scanning = true;
    try {
      const result = await scan({ ignoreSettings: force });
      if (!result.disabled) {
        const collection = collectionFromScan(result);
        const rollup = buildRollup(
          result.records, result.sessionsBySource, result.projectPaths, collection,
        );
        writeJson(ROLLUP_FILE, rollup);
      }
      lastScan = {
        at: new Date().toISOString(),
        records: result.records.length,
        elapsedMs: result.elapsedMs,
        stats: result.stats,
        warnings: result.warnings,
        indexing: result.indexing,
        disabled: Boolean(result.disabled),
      };
      onScan?.(lastScan);
      return lastScan;
    } catch (err) {
      onError?.(err);
      lastScan = { at: new Date().toISOString(), error: err.message };
      return lastScan;
    } finally {
      scanning = false;
      const hasBacklog = Boolean(lastScan?.indexing)
        || (lastScan?.stats?.deferred ?? 0) > 0;
      scheduleScan(hasBacklog ? catchUpIntervalMs : scanIntervalMs);
      scheduleRequestedScan();
    }
  }

  async function tick() {
    try {
      const result = await tailer.poll();
      live.tokensPerMin = result.tokensPerMin;
      live.tokensPerMinBySource = result.tokensPerMinBySource ?? {};
      live.sources = [...new Set(result.fresh.map((r) => r.source))];
      live.trackedFiles = result.trackedFiles;
      live.disabled = Boolean(result.disabled);
      live.updatedAt = new Date().toISOString();
      onTick?.(live);
    } catch (err) {
      onError?.(err);
    }
  }

  return {
    /** 首次启动会立刻扫一次，之后按节拍。 */
    async start({ scanNow = true } = {}) {
      if (!stopped) return;
      stopped = false;
      const currentLifecycle = ++lifecycle;
      if (scanNow) await runScan();
      else scheduleScan(diskHasBacklog({ force: true }) ? catchUpIntervalMs : scanIntervalMs);
      if (stopped || currentLifecycle !== lifecycle) return;
      tailTimer = setInterval(() => { if (!stopped) tick(); }, tailIntervalMs);
      // 让定时器不阻止进程退出——CLI 与服务端各自决定生命周期。
      tailTimer.unref?.();
      scheduleReconciliation();
    },

    stop() {
      stopped = true;
      lifecycle++;
      if (tailTimer) clearInterval(tailTimer);
      if (scanTimer) clearTimeout(scanTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      tailTimer = null;
      scanTimer = null;
      reconcileTimer = null;
      nextScanAt = null;
      scanRequested = false;
      requestedForce = false;
      requestScheduled = false;
    },

    /** 用户点「重新扫描」时用 force，绕过开关只此一次。 */
    scanNow: (options) => runScan(options),
    /** Hook 写入通知：合并并发请求；若正在扫描，当前轮结束后保证再扫一次。 */
    requestScan,
    status: () => ({
      running: !stopped,
      scanning,
      enabled: usageEnabled(),
      live: { ...live },
      lastScan,
    }),
    live: () => ({ ...live }),
  };
}
