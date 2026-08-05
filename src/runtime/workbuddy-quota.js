import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { recordQuota } from './account-quota.js';
import { loadSettings } from './settings.js';

const ACTIVE_RESOURCE_STATUS = new Set([0, 3]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;

function number(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function amount(resource, preciseKey, fallbackKey) {
  return number(resource?.[preciseKey]) ?? number(resource?.[fallbackKey]);
}

function localDateMilliseconds(value, timeZoneOffsetMinutes) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second),
  ) - timeZoneOffsetMinutes * 60_000;
}

function resourceResetAt(resource, timeZoneOffsetMinutes, isBase) {
  if (isBase) {
    const cycleEnd = localDateMilliseconds(resource?.CycleEndTime, timeZoneOffsetMinutes);
    if (cycleEnd !== null) return cycleEnd + 1000;
  }
  const deduction = number(resource?.DeductionEndTime);
  if (deduction !== null && deduction > 0) {
    const milliseconds = deduction > 10_000_000_000 ? deduction : deduction * 1000;
    return milliseconds + 1000;
  }
  const raw = resource?.ExpiredTime ?? resource?.CycleEndTime;
  const parsed = localDateMilliseconds(raw, timeZoneOffsetMinutes);
  return parsed === null ? null : parsed + 1000;
}

/** WorkBuddy `get-user-resource` 响应 → Maclawd 通用额度上报。 */
export function workBuddyQuotaReport(payload, { timeZoneOffsetMinutes = 480 } = {}) {
  const accounts = payload?.data?.Response?.Data?.Accounts;
  if (!Array.isArray(accounts)) return null;

  const windows = {};
  let baseIndex = 0;
  let bonusIndex = 0;
  for (const resource of accounts) {
    if (!resource || typeof resource !== 'object') continue;
    const status = number(resource.Status);
    if (status !== null && !ACTIVE_RESOURCE_STATUS.has(status)) continue;

    const isBase = number(resource.CapacityType) === 4;
    const fields = isBase
      ? ['CycleCapacity', 'Capacity']
      : ['Capacity', 'CycleCapacity'];
    const readAmount = (suffix) => amount(resource, `${fields[0]}${suffix}Precise`, `${fields[0]}${suffix}`)
      ?? amount(resource, `${fields[1]}${suffix}Precise`, `${fields[1]}${suffix}`);
    const limit = readAmount('Size');
    if (limit === null || limit <= 0) continue;
    const usedRaw = readAmount('Used');
    const remainingRaw = readAmount('Remain');
    const used = Math.max(0, usedRaw ?? (limit - (remainingRaw ?? limit)));
    const remaining = Math.max(0, remainingRaw ?? (limit - used));
    const kind = isBase ? 'base' : 'bonus';
    const index = isBase ? ++baseIndex : ++bonusIndex;
    const key = `${kind}_${stableResourceNumber(resource, index)}`;
    const fallbackLabel = isBase ? '基础包' : '额外包';
    const label = typeof resource.PackageName === 'string' && resource.PackageName.trim()
      ? resource.PackageName.trim().slice(0, 48) : fallbackLabel;
    windows[key] = {
      label,
      kind,
      used,
      limit,
      remaining,
      usedPercent: Math.max(0, Math.min(100, used / limit * 100)),
      resetAt: resourceResetAt(resource, timeZoneOffsetMinutes, isBase),
    };
  }

  if (Object.keys(windows).length === 0) return null;
  return {
    source: 'workbuddy',
    sourceLabel: 'WorkBuddy',
    completeSnapshot: true,
    windows,
  };
}

function stableResourceNumber(resource, fallbackIndex) {
  const identity = [
    resource?.AccountId, resource?.ResourceId, resource?.PackageId,
    resource?.PackageCode, resource?.PackageName, resource?.CycleEndTime,
    resource?.ExpiredTime, resource?.DeductionEndTime, resource?.CapacityType,
  ].filter((value) => value !== null && value !== undefined && String(value).trim()).join('|');
  if (!identity) return fallbackIndex;
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** 企业账号的计费响应不是资源数组，而是一组总额/已用/周期字段。 */
export function workBuddyEnterpriseQuotaReport(payload, { timeZoneOffsetMinutes = 480 } = {}) {
  const first = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const data = first?.data && typeof first.data === 'object' ? first.data : first;
  const limit = number(data?.limitNum);
  if (limit === null || limit <= 0) return null;
  const used = Math.max(0, number(data?.credit) ?? 0);
  const remaining = Math.max(0, limit - used);
  const cycleReset = localDateMilliseconds(data?.cycleResetTime, timeZoneOffsetMinutes);
  return {
    source: 'workbuddy',
    sourceLabel: 'WorkBuddy',
    planType: 'enterprise',
    completeSnapshot: true,
    windows: {
      base_1: {
        label: '企业额度',
        kind: 'base',
        used,
        limit,
        remaining,
        usedPercent: Math.max(0, Math.min(100, used / limit * 100)),
        resetAt: cycleReset === null ? null : cycleReset + 1000,
      },
    },
  };
}

export function workBuddyAuthDirectories({
  home = homedir(),
  platform = process.platform,
  env = process.env,
} = {}) {
  const extensionAuthDirs = (base) => ['CodeBuddyExtension', 'WorkBuddyExtension']
    .map((name) => join(base, name, 'Data', 'Public', 'auth'));
  if (platform === 'darwin') {
    return extensionAuthDirs(join(home, 'Library', 'Application Support'));
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return extensionAuthDirs(base);
  }
  const base = env.XDG_DATA_HOME || join(home, '.local', 'share');
  return extensionAuthDirs(base);
}

function credentialFromJson(raw, sourcePath) {
  let value;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const account = value.account && typeof value.account === 'object' ? value.account : {};
  const auth = value.auth && typeof value.auth === 'object' ? value.auth : value;
  let accessToken = auth.accessToken ?? auth.access_token ?? value.accessToken ?? value.access_token;
  if (typeof accessToken !== 'string' || !accessToken.trim()) return null;
  accessToken = accessToken.trim();
  let tokenUid = null;
  if (accessToken.includes('+')) {
    const split = accessToken.indexOf('+');
    tokenUid = accessToken.slice(0, split).trim() || null;
    accessToken = accessToken.slice(split + 1).trim();
  }
  if (!accessToken) return null;
  const text = (candidate) => (typeof candidate === 'string' && candidate.trim()
    ? candidate.trim() : null);
  return {
    accessToken,
    uid: text(account.uid) ?? text(account.id) ?? tokenUid,
    enterpriseId: text(account.enterpriseId) ?? text(value.enterpriseId),
    domain: text(auth.domain) ?? text(value.domain),
    sourcePath,
  };
}

/** 只读发现本机 WorkBuddy 登录凭据；调用方不得持久化或记录返回值。 */
export function findWorkBuddyCredential({
  authDirs = workBuddyAuthDirectories(),
  readdir = readdirSync,
  readFile = readFileSync,
} = {}) {
  for (const authDir of authDirs) {
    let names;
    try {
      const directoryNames = readdir(authDir);
      const present = new Set(directoryNames);
      names = directoryNames
        .filter((name) => typeof name === 'string' && name.endsWith('.info'))
        .filter((name) => !present.has(`${name}.logged-out`))
        .sort((a, b) => {
          const priority = (name) => (name === 'workbuddy-desktop.info' ? 0
            : name === 'workbuddy-desktop-ai.info' ? 1
              : name.toLowerCase().includes('workbuddy') ? 2 : 3);
          return priority(a) - priority(b) || a.localeCompare(b);
        });
    } catch {
      continue;
    }
    for (const name of names) {
      const sourcePath = join(authDir, name);
      try {
        const credential = credentialFromJson(readFile(sourcePath, 'utf8'), sourcePath);
        if (credential) return credential;
      } catch {
        // 一个损坏/不可读文件不应挡住同目录里的其它 WorkBuddy 身份。
      }
    }
  }
  return null;
}

function allowedWorkBuddyHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let hostname;
  try {
    const candidate = value.includes('://') ? value : `https://${value}`;
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
  const allowed = ['codebuddy.cn', 'codebuddy.ai', 'tencent.com'];
  return allowed.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
    ? hostname : null;
}

function workBuddyHosts(domain, enterprise) {
  const preferred = allowedWorkBuddyHost(domain);
  // WorkBuddy Token 具有域绑定语义，绝不能因为请求失败而带到另一个域名。
  return [preferred ?? (enterprise ? 'copilot.tencent.com' : 'www.codebuddy.cn')];
}

function gatewayDate(value) {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part) => String(part).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function quotaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** 用 WorkBuddy 本机身份读取一次账户积分。Token 只进入请求头，不返回、不落盘。 */
export async function readWorkBuddyQuota({
  credential = findWorkBuddyCredential(),
  fetchImpl = globalThis.fetch,
  now = new Date(),
  signal = null,
  timeoutMs = 10_000,
  timeZoneOffsetMinutes = 480,
} = {}) {
  if (!credential?.accessToken) throw quotaError('ENOAUTH', '未找到 WorkBuddy 登录信息');
  if (typeof fetchImpl !== 'function') throw quotaError('ENETWORK', '当前运行时不支持网络请求');

  const enterprise = Boolean(credential.enterpriseId);
  const rangeEnd = new Date(now.getTime() + 365 * 101 * 24 * 60 * 60 * 1000);
  const personalBody = {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [0, 3],
    PackageEndTimeRangeBegin: gatewayDate(now),
    PackageEndTimeRangeEnd: gatewayDate(rangeEnd),
  };
  const body = JSON.stringify(enterprise ? {} : personalBody);
  let lastError = null;
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  if (signal?.aborted) requestController.abort();
  const timeout = setTimeout(() => requestController.abort(), timeoutMs);
  timeout.unref?.();

  try {
    for (const host of workBuddyHosts(credential.domain, enterprise)) {
      try {
        const headers = {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.accessToken}`,
        };
        if (credential.uid) headers['X-User-Id'] = credential.uid;
        if (credential.enterpriseId) {
          headers['X-Enterprise-Id'] = credential.enterpriseId;
          headers['X-Tenant-Id'] = credential.enterpriseId;
        }
        const domain = allowedWorkBuddyHost(credential.domain);
        if (domain) headers['X-Domain'] = domain;

        const response = await fetchImpl(
          `https://${host}${host === 'copilot.tencent.com' ? '' : '/v2'}/billing/meter/`
            + (enterprise ? 'get-enterprise-user-usage' : 'get-user-resource'),
          { method: 'POST', headers, body, signal: requestController.signal },
        );
        if (!response?.ok) {
          const code = response?.status === 401 || response?.status === 403 ? 'EAUTH'
            : response?.status === 429 ? 'ERATELIMIT' : 'EHTTP';
          throw quotaError(code, code === 'EAUTH'
            ? 'WorkBuddy 登录状态已失效'
            : `WorkBuddy 计费服务返回 HTTP ${response?.status ?? '?'}`);
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
          throw quotaError('EOVERFLOW', 'WorkBuddy 计费响应过大');
        }
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw quotaError('EPROTO', 'WorkBuddy 计费服务返回了无法解析的数据');
        }
        if (number(payload?.code) !== null && ![0, 200].includes(number(payload.code))) {
          throw quotaError('EREMOTE', 'WorkBuddy 计费服务拒绝了额度查询');
        }
        const report = enterprise
          ? workBuddyEnterpriseQuotaReport(payload, { timeZoneOffsetMinutes })
          : workBuddyQuotaReport(payload, { timeZoneOffsetMinutes });
        if (!report) throw quotaError('ENODATA', 'WorkBuddy 暂未返回可用积分');
        return report;
      } catch (error) {
        if (requestController.signal.aborted) {
          if (signal?.aborted) {
            const aborted = quotaError('EABORT', 'WorkBuddy 积分读取已取消');
            aborted.name = 'AbortError';
            throw aborted;
          }
          throw quotaError('ETIMEDOUT', 'WorkBuddy 积分读取超时');
        }
        lastError = error?.code ? error : quotaError('ENETWORK', '无法连接 WorkBuddy 计费服务');
      }
    }
    throw lastError ?? quotaError('ENETWORK', '无法连接 WorkBuddy 计费服务');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

/** 后台额度采集器：有界刷新、并发合并、成功缓存、关闭后丢弃在途结果。 */
export function createWorkBuddyQuotaCollector({
  intervalMs = DEFAULT_REFRESH_MS,
  enabled = () => loadSettings().quotaTracking === true,
  read = readWorkBuddyQuota,
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
            ? error.message.slice(0, 160) : 'WorkBuddy 积分读取失败',
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
