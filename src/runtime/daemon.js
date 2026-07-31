import { scanAll } from './scan.js';
import { buildRollup } from './rollup.js';
import { createTailer } from './tail.js';
import { writeJson } from './store.js';
import { ROLLUP_FILE } from './paths.js';
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

export function createCollector({
  tailIntervalMs = DEFAULT_TAIL_MS,
  scanIntervalMs = DEFAULT_SCAN_MS,
  onScan = null,
  onTick = null,
  onError = null,
} = {}) {
  const tailer = createTailer();
  let tailTimer = null;
  let scanTimer = null;
  let scanning = false;
  let stopped = true;

  const live = {
    tokensPerMin: 0,
    intensityInput: 0,
    sources: [],
    trackedFiles: 0,
    disabled: false,
    updatedAt: null,
  };
  let lastScan = null;

  async function runScan({ force = false } = {}) {
    if (scanning) return null;
    if (!force && !usageEnabled()) {
      lastScan = { disabled: true, at: new Date().toISOString() };
      return lastScan;
    }
    scanning = true;
    try {
      const result = await scanAll({ ignoreSettings: force });
      if (!result.disabled) {
        const rollup = buildRollup(result.records, result.sessionsBySource, result.projectPaths);
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
    }
  }

  async function tick() {
    try {
      const result = await tailer.poll();
      live.tokensPerMin = result.tokensPerMin;
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
      if (scanNow) await runScan();
      tailTimer = setInterval(() => { if (!stopped) tick(); }, tailIntervalMs);
      scanTimer = setInterval(() => { if (!stopped) runScan(); }, scanIntervalMs);
      // 让定时器不阻止进程退出——CLI 与服务端各自决定生命周期。
      tailTimer.unref?.();
      scanTimer.unref?.();
    },

    stop() {
      stopped = true;
      if (tailTimer) clearInterval(tailTimer);
      if (scanTimer) clearInterval(scanTimer);
      tailTimer = null;
      scanTimer = null;
    },

    /** 用户点「重新扫描」时用 force，绕过开关只此一次。 */
    scanNow: (options) => runScan(options),
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
