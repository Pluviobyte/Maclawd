/**
 * Cursor 订阅额度读取 → Maclawd 通用额度上报。
 *
 * 读取 Cursor 本地 SQLite 数据库中的 access/refresh token，
 * 然后调用 Cursor 编辑器使用的 API 获取当前计费周期用量。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { recordQuota } from './account-quota.js';
import { loadSettings } from './settings.js';
import {
  cursorDashboardHeaders, decodeCursorJwtSub, fetchCursorWithAuth,
} from './cursor-auth.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;
const CURRENT_PERIOD_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const TOKEN_REFRESH_URL = 'https://api2.cursor.sh/oauth/token';
const CURSOR_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';

function cursorDbPath({ home = homedir() } = {}) {
  return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

/**
 * 从 Cursor 本地 SQLite 数据库读取 access token。
 * 使用 macOS 自带的 sqlite3 CLI 工具。
 */
export async function readCursorToken(options = {}) {
  return (await readCursorAuth(options)).accessToken;
}

/** 从 Cursor 本地 SQLite 一次读取可用于自动续期的完整凭据。 */
export function readCursorAuth({
  dbPath = cursorDbPath(),
  execFileImpl = execFile,
  timeoutMs = 5_000,
  signal = null,
  exists = existsSync,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!exists(dbPath)) {
      const error = new Error('未找到 Cursor 数据库');
      error.code = 'ENOENT';
      reject(error);
      return;
    }
    const abortHandler = () => {
      const error = new Error('Cursor 凭据读取已取消');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      reject(error);
    };
    if (signal?.aborted) { abortHandler(); return; }
    signal?.addEventListener?.('abort', abortHandler, { once: true });
    const sql = "SELECT key || char(9) || value FROM ItemTable WHERE key IN ('cursorAuth/accessToken','cursorAuth/refreshToken') ORDER BY key";
    const child = execFileImpl('sqlite3', [dbPath, sql], {
      timeout: timeoutMs, maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      signal?.removeEventListener?.('abort', abortHandler);
      if (error) {
        if (signal?.aborted) { abortHandler(); return; }
        const wrapped = new Error(`Cursor 凭据读取失败: ${error.message}`);
        wrapped.code = error.code ?? 'ECHILD';
        reject(wrapped);
        return;
      }
      const values = new Map(String(stdout ?? '').trim().split(/\r?\n/).map((line) => {
        const tab = line.indexOf('\t');
        return tab < 0 ? [line, ''] : [line.slice(0, tab), line.slice(tab + 1)];
      }));
      const accessToken = parseCursorToken(values.get('cursorAuth/accessToken'));
      const refreshToken = parseCursorToken(values.get('cursorAuth/refreshToken'));
      if (!accessToken) {
        const missing = new Error('Cursor 数据库中未找到 access token');
        missing.code = 'ENODATA';
        reject(missing);
        return;
      }
      resolve({ accessToken, refreshToken });
    });
    child?.unref?.();
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
    const limitValue = value.maxRequestUsage ?? value.numRequestsTotal;
    const numRequestsTotal = typeof limitValue === 'number' ? limitValue : null;
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

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function percent(value) {
  const number = finite(value);
  return number === null ? null : Math.max(0, Math.min(100, number));
}

function jwtExpiresSoon(token, { now = Date.now(), leewayMs = 5 * 60_000 } = {}) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= now + leewayMs;
  } catch {
    return false;
  }
}

async function responsePayload(response) {
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    const error = new Error('Cursor usage 响应过大');
    error.code = 'EOVERFLOW';
    throw error;
  }
  try { return JSON.parse(body); } catch {
    const error = new Error('Cursor usage API 返回了无法解析的数据');
    error.code = 'EPROTO';
    throw error;
  }
}

/** Cursor 现代套餐：当前账单周期总额度，以及 Cursor/Other Models 两个用量池。 */
export function cursorCurrentPeriodReport(data) {
  if (!data || typeof data !== 'object' || data.enabled === false) return null;
  const usage = data.planUsage ?? data.plan_usage;
  if (!usage || typeof usage !== 'object') return null;

  const limit = finite(usage.limit);
  const spend = finite(usage.totalSpend ?? usage.total_spend);
  const reportedTotal = percent(usage.totalPercentUsed ?? usage.total_percent_used);
  const computedTotal = limit !== null && limit > 0 && spend !== null
    ? percent(spend / limit * 100) : null;
  const total = reportedTotal ?? computedTotal;
  if (total === null) return null;

  const start = timestamp(data.billingCycleStart ?? data.billing_cycle_start);
  const end = timestamp(data.billingCycleEnd ?? data.billing_cycle_end);
  const durationMinutes = start !== null && end !== null && end > start
    ? Math.round((end - start) / 60_000) : null;
  const shared = {
    resetAt: end,
    ...(durationMinutes !== null ? { durationMinutes } : {}),
  };
  const windows = {
    current_period_total: {
      label: '本周', usedPercent: total, ...shared,
    },
  };
  const auto = percent(usage.autoPercentUsed ?? usage.auto_percent_used);
  const api = percent(usage.apiPercentUsed ?? usage.api_percent_used);
  if (auto !== null) {
    windows.current_period_auto = {
      label: 'Cursor Models', usedPercent: auto, ...shared,
    };
  }
  if (api !== null) {
    windows.current_period_api = {
      label: 'Other Models', usedPercent: api, ...shared,
    };
  }
  return { source: 'cursor', sourceLabel: 'Cursor', completeSnapshot: true, windows };
}

/**
 * 读取一次 Cursor 用量。先取 token，再请求 usage API。
 */
export async function readCursorUsage({
  signal = null,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  tokenReader = readCursorAuth,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    const error = new Error('当前运行时不支持网络请求');
    error.code = 'ENETWORK';
    throw error;
  }

  const rawAuth = await tokenReader({ signal });
  const auth = typeof rawAuth === 'string'
    ? { accessToken: rawAuth, refreshToken: null }
    : {
      accessToken: parseCursorToken(rawAuth?.accessToken),
      refreshToken: parseCursorToken(rawAuth?.refreshToken),
    };
  if (!auth.accessToken) {
    const error = new Error('Cursor 数据库中未找到 access token');
    error.code = 'ENODATA';
    throw error;
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    let activeToken = auth.accessToken;
    const refreshAccessToken = async () => {
      if (!auth.refreshToken) return null;
      const refreshed = await fetchImpl(TOKEN_REFRESH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token', client_id: CURSOR_CLIENT_ID,
          refresh_token: auth.refreshToken,
        }),
        signal: controller.signal,
      });
      if (!refreshed?.ok) return null;
      const refreshPayload = await responsePayload(refreshed);
      return parseCursorToken(refreshPayload?.access_token);
    };
    const requestCurrentPeriod = (accessToken) => fetchImpl(CURRENT_PERIOD_URL, {
      method: 'POST', headers: {
        Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      }, body: '{}', signal: controller.signal,
    });
    if (auth.refreshToken && jwtExpiresSoon(activeToken)) {
      activeToken = await refreshAccessToken() ?? activeToken;
    }
    let response = await requestCurrentPeriod(activeToken);
    if ([401, 403].includes(response?.status) && auth.refreshToken) {
      const freshToken = await refreshAccessToken();
      if (freshToken) {
        activeToken = freshToken;
        response = await requestCurrentPeriod(activeToken);
      }
    }

    if (!response?.ok) {
      const code = response?.status === 401 || response?.status === 403 ? 'EAUTH'
        : response?.status === 429 ? 'ERATELIMIT' : 'EHTTP';
      const error = new Error(code === 'EAUTH'
        ? 'Cursor 登录状态已失效'
        : `Cursor usage API 返回 HTTP ${response?.status ?? '?'}`);
      error.code = code;
      throw error;
    }

    const payload = await responsePayload(response);
    const report = cursorCurrentPeriodReport(payload);
    if (report) return report;

    const subject = decodeCursorJwtSub(activeToken);
    const userId = subject?.split('|').at(-1);
    if (userId) {
      const legacyURL = `https://cursor.com/api/usage?user=${encodeURIComponent(userId)}`;
      const legacyResponse = await fetchCursorWithAuth(legacyURL, {
        token: activeToken, fetchImpl, headers: cursorDashboardHeaders(),
        signal: controller.signal,
      });
      if (legacyResponse?.ok) {
        const legacyReport = cursorUsageReport(await responsePayload(legacyResponse));
        if (legacyReport) return legacyReport;
      }
    }
    {
      const error = new Error('Cursor 暂未返回可用额度');
      error.code = 'ENODATA';
      throw error;
    }
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
