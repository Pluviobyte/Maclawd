/**
 * Cursor 订阅额度读取 → Maclawd 通用额度上报。
 *
 * 读取 Cursor 本地 SQLite 数据库中的 access token，
 * 然后调用 Cursor 官方 usage API 获取模型用量。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { recordQuota } from './account-quota.js';
import { loadSettings } from './settings.js';
import { cursorDashboardHeaders, fetchCursorWithAuth } from './cursor-auth.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;

function cursorDbPath({ home = homedir() } = {}) {
  return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

/**
 * 从 Cursor 本地 SQLite 数据库读取 access token。
 * 使用 macOS 自带的 sqlite3 CLI 工具。
 */
export function readCursorToken({
  dbPath = cursorDbPath(),
  execFileImpl = execFile,
  timeoutMs = 5_000,
  signal = null,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!existsSync(dbPath)) {
      const error = new Error('未找到 Cursor 数据库');
      error.code = 'ENOENT';
      reject(error);
      return;
    }

    const abortHandler = () => {
      const error = new Error('Cursor Token 读取已取消');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      reject(error);
    };
    if (signal?.aborted) { abortHandler(); return; }
    signal?.addEventListener?.('abort', abortHandler, { once: true });

    const child = execFileImpl(
      'sqlite3',
      [dbPath, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        signal?.removeEventListener?.('abort', abortHandler);
        if (error) {
          if (signal?.aborted) { abortHandler(); return; }
          const wrapped = new Error(`Cursor Token 读取失败: ${error.message}`);
          wrapped.code = error.code ?? 'ECHILD';
          reject(wrapped);
          return;
        }
        const token = parseCursorToken(stdout);
        if (!token) {
          const missing = new Error('Cursor 数据库中未找到 access token');
          missing.code = 'ENODATA';
          reject(missing);
          return;
        }
        resolve(token);
      },
    );
    // execFile 返回 ChildProcess 或在测试中可能为 undefined
    if (child && typeof child.unref === 'function') child.unref();
  });
}

/** 从 sqlite3 输出解析 token 字符串。 */
export function parseCursorToken(stdout) {
  if (typeof stdout !== 'string') return null;
  const token = stdout.trim();
  return token || null;
}

/** 解析 Cursor usage API 响应并生成额度报告。 */
export function cursorUsageReport(data) {
  if (!data || typeof data !== 'object') return null;

  let totalUsed = 0;
  let totalLimit = 0;
  let startOfMonth = null;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'startOfMonth') {
      startOfMonth = value;
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const numRequests = typeof value.numRequests === 'number' ? value.numRequests : null;
    const numRequestsTotal = typeof value.numRequestsTotal === 'number' ? value.numRequestsTotal : null;
    if (numRequestsTotal === null || numRequestsTotal <= 0) continue;
    totalUsed += numRequests ?? 0;
    totalLimit += numRequestsTotal;
  }

  if (totalLimit <= 0) return null;

  const usedPercent = Math.max(0, Math.min(100, (totalUsed / totalLimit) * 100));

  let nextMonthMs = null;
  if (startOfMonth) {
    const start = new Date(startOfMonth);
    if (!Number.isNaN(start.getTime())) {
      const nextMonth = new Date(start);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      nextMonthMs = nextMonth.getTime();
    }
  }

  return {
    source: 'cursor',
    sourceLabel: 'Cursor',
    completeSnapshot: true,
    windows: {
      monthly_requests: {
        usedPercent,
        used: totalUsed,
        limit: totalLimit,
        remaining: totalLimit - totalUsed,
        resetAt: nextMonthMs,
        label: '本月请求',
      },
    },
  };
}

/**
 * 读取一次 Cursor 用量。先取 token，再请求 usage API。
 */
export async function readCursorUsage({
  signal = null,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  tokenReader = readCursorToken,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    const error = new Error('当前运行时不支持网络请求');
    error.code = 'ENETWORK';
    throw error;
  }

  const token = await tokenReader({ signal });

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    // www.cursor.com 会跳转到 cursor.com，跨 host 跳转会丢失 Cookie/Authorization。
    const response = await fetchCursorWithAuth('https://cursor.com/api/usage', {
      token,
      fetchImpl,
      method: 'GET',
      headers: cursorDashboardHeaders(),
      signal: controller.signal,
    });

    if (!response?.ok) {
      const code = response?.status === 401 || response?.status === 403 ? 'EAUTH'
        : response?.status === 429 ? 'ERATELIMIT' : 'EHTTP';
      const error = new Error(code === 'EAUTH'
        ? 'Cursor 登录状态已失效'
        : `Cursor usage API 返回 HTTP ${response?.status ?? '?'}`);
      error.code = code;
      throw error;
    }

    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      const error = new Error('Cursor usage 响应过大');
      error.code = 'EOVERFLOW';
      throw error;
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      const error = new Error('Cursor usage API 返回了无法解析的数据');
      error.code = 'EPROTO';
      throw error;
    }

    const report = cursorUsageReport(payload);
    if (!report) {
      const error = new Error('Cursor 暂未返回可用额度');
      error.code = 'ENODATA';
      throw error;
    }
    return report;
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) {
        const aborted = new Error('Cursor 额度读取已取消');
        aborted.name = 'AbortError';
        aborted.code = 'ABORT_ERR';
        throw aborted;
      }
      const timedOut = new Error('Cursor 额度读取超时');
      timedOut.code = 'ETIMEDOUT';
      throw timedOut;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

/** 后台额度采集器：有界刷新、并发合并、成功缓存、关闭后丢弃在途结果。 */
export function createCursorQuotaCollector({
  intervalMs = DEFAULT_REFRESH_MS,
  enabled = () => loadSettings().quotaTracking === true,
  read = readCursorUsage,
  record = recordQuota,
  onError = null,
} = {}) {
  let timer = null;
  let stopped = true;
  let refreshing = null;
  let lastAttemptAt = 0;
  let lastSuccessAt = 0;
  let lastError = null;
  let lifecycle = 0;
  let currentAbort = null;

  async function refresh({ force = false } = {}) {
    if (!enabled()) return { disabled: true };
    const now = Date.now();
    if (!force && lastSuccessAt > 0 && now - lastSuccessAt < intervalMs) {
      return { cached: true, lastSuccessAt };
    }
    if (refreshing) return refreshing;
    const refreshLifecycle = lifecycle;
    const controller = new AbortController();
    currentAbort = controller;
    const task = (async () => {
      lastAttemptAt = Date.now();
      try {
        const report = await read({ signal: controller.signal });
        if (!enabled() || refreshLifecycle !== lifecycle) return { discarded: true };
        record(report);
        lastSuccessAt = Date.now();
        lastError = null;
        return { reports: 1, lastSuccessAt };
      } catch (error) {
        if (controller.signal.aborted || refreshLifecycle !== lifecycle) {
          return { discarded: true };
        }
        lastError = {
          code: typeof error?.code === 'string' ? error.code : 'EUNKNOWN',
          message: typeof error?.message === 'string'
            ? error.message.slice(0, 160) : 'Cursor 额度读取失败',
        };
        onError?.(error);
        return { error: lastError };
      }
    })();
    refreshing = task;
    try {
      return await task;
    } finally {
      if (refreshing === task) refreshing = null;
      if (currentAbort === controller) currentAbort = null;
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      lifecycle++;
      void refresh({ force: true });
      timer = setInterval(() => { if (!stopped) void refresh(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      lifecycle++;
      currentAbort?.abort();
      if (timer) clearInterval(timer);
      timer = null;
    },
    refresh,
    status: () => ({
      running: !stopped,
      refreshing: Boolean(refreshing),
      lastAttemptAt,
      lastSuccessAt,
      lastError,
    }),
  };
}
