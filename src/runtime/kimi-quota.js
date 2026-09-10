import { readFile } from 'node:fs/promises';
import { existsSync, accessSync, statSync, constants } from 'node:fs';
import { loadSettings, usageEnabled } from './settings.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readKimiDesktopAuth } from './desktop-quota-auth.js';
import { finiteNumber, isoTime, quotaError, quotaJson } from './quota-client.js';
import { createProviderQuotaCollector } from './provider-quota-collector.js';

const MEMBERSHIP_PATH = '/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats';
const CODE_ORIGINS = new Set(['https://api.kimi.com', 'https://api.kimi.ai']);

function ratioWindow(value, label, durationMinutes) {
  if (!value || value.enabled === false) return null;
  const ratio = finiteNumber(value.ratio);
  if (ratio === null || ratio < 0 || ratio > 1) return null;
  return { label, usedPercent: ratio * 100, resetAt: isoTime(value.resetTime), durationMinutes };
}

/** Membership pool and Code rate limits are independent; a Free pool need not be monthly. */
export function kimiMembershipReport(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const windows = {};
  const balance = payload.subscriptionBalance;
  const ratio = finiteNumber(balance?.amountUsedRatio);
  if (ratio !== null && ratio >= 0 && ratio <= 1) {
    windows.total = { label: '总额度', usedPercent: ratio * 100, resetAt: isoTime(balance.expireTime) };
  }
  for (const [field, key, label, duration] of [
    ['ratelimit5h', 'work_five_hour', '工作 5 小时', 300],
    ['ratelimit7d', 'work_seven_day', '工作 7 天', 10080],
    ['ratelimitCode5h', 'code_five_hour', 'Code 5 小时', 300],
    ['ratelimitCode7d', 'code_seven_day', 'Code 7 天', 10080],
  ]) {
    const window = ratioWindow(payload[field], label, duration);
    if (window) windows[key] = window;
  }
  if (!Object.keys(windows).length) return null;
  return { source: 'kimi', sourceLabel: 'Kimi', completeSnapshot: true, windows };
}

function durationMinutes(window) {
  const duration = finiteNumber(window?.duration);
  const unit = window?.timeUnit?.replace(/^TIME_UNIT_/, '');
  const factor = { MINUTE: 1, HOUR: 60, DAY: 1440, WEEK: 10080 }[unit];
  const minutes = duration * factor;
  return duration > 0 && Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

export function kimiCodeReport(payload) {
  const windows = {};
  const entries = [];
  if (payload?.usage && typeof payload.usage === 'object') entries.push([payload.usage, payload.usage.window ? durationMinutes(payload.usage.window) : 10080]);
  for (const limit of Array.isArray(payload?.limits) ? payload.limits : []) {
    entries.push([limit?.detail, durationMinutes(limit?.window)]);
  }
  for (const [detail, minutes] of entries) {
    const limit = finiteNumber(detail?.limit);
    // Managed API proto3 may omit used=0, but only inside a recognized, positive-limit quota object.
    const used = detail?.used === undefined ? 0 : finiteNumber(detail.used);
    if (!detail || !minutes || limit === null || limit <= 0 || used === null || used < 0) continue;
    const key = `duration_${minutes}`;
    const window = {
      label: minutes === 300 ? '5 小时' : minutes === 10080 ? '7 天'
        : minutes % 1440 === 0 ? `${minutes / 1440} 天` : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`,
      usedPercent: Math.min(100, used / limit * 100),
      resetAt: isoTime(detail.resetTime), durationMinutes: minutes,
    };
    // Multiple contradictory limits of equal duration are ambiguous; do not pick an arbitrary one.
    if (windows[key] && (windows[key].usedPercent !== window.usedPercent || windows[key].resetAt !== window.resetAt)) return null;
    windows[key] = window;
  }
  return Object.keys(windows).length ? { source: 'kimi-code', sourceLabel: 'Kimi Code CLI', completeSnapshot: true, windows } : null;
}

/** Read the small generated TOML auth tables; unknown syntax fails closed, never chooses a wrong account. */
export function kimiCodeConfigAuth(text = '') {
  const result = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      const match = /^\[providers\.(?:"managed:kimi-code"|'managed:kimi-code')(\.oauth)?\]\s*(?:#.*)?$/.exec(line);
      section = match ? (match[1] ? 'oauth' : 'provider') : null;
      continue;
    }
    if (!section) continue;
    if (section === 'provider' && /^oauth\s*=/.test(line)) throw quotaError('ECONFIG', 'Kimi Code 登录配置使用暂不支持的内联格式');
    const match = /^(base_url|key|storage|oauthHost)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if (!match) {
      if (/^(base_url|key|storage|oauthHost)\s*=/.test(line)) throw quotaError('ECONFIG', 'Kimi Code 登录配置格式不受支持');
      continue;
    }
    let value;
    try { value = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2].slice(1, -1); }
    catch { throw quotaError('ECONFIG', 'Kimi Code 登录配置格式无效'); }
    result[match[1]] = value;
  }
  return result;
}

export async function readKimiCodeAuth({ home = homedir(), env = process.env, read = readFile } = {}) {
  const roots = [env.MACLAWD_KIMI_CODE_DIR || env.KIMI_CODE_HOME || join(home, '.kimi-code'),
    env.MACLAWD_KIMI_LEGACY_DIR || join(home, '.kimi')];
  for (const root of [...new Set(roots)]) {
    let configText = '';
    try { configText = await read(join(root, 'config.toml'), 'utf8'); } catch { /* Legacy installation may have no config. */ }
    if (Buffer.byteLength(configText) > 1024 * 1024) throw quotaError('ECONFIG', 'Kimi Code 配置超过大小限制');
    const config = kimiCodeConfigAuth(configText);
    let endpoint;
    try { endpoint = new URL(env.KIMI_CODE_BASE_URL || config.base_url || 'https://api.kimi.com/coding/v1'); }
    catch { throw quotaError('EORIGIN', 'Kimi Code 服务地址无效'); }
    if (!CODE_ORIGINS.has(endpoint.origin) || endpoint.pathname.replace(/\/$/, '') !== '/coding/v1'
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw quotaError('EORIGIN', 'Kimi Code 服务地址不属于官方额度服务');
    const origin = endpoint.origin;
    if (env.KIMI_CODE_BASE_URL && config.base_url && new URL(config.base_url).origin !== origin) {
      throw quotaError('EORIGIN', 'Kimi Code 环境地址与本地登录地区不一致');
    }
    if (config.oauthHost && config.oauthHost !== (origin.endsWith('.ai') ? 'https://auth.kimi.ai' : 'https://auth.kimi.com')) {
      throw quotaError('EORIGIN', 'Kimi Code 登录与服务地区不一致');
    }
    if (config.storage && config.storage !== 'file') throw quotaError('ECONFIG', 'Kimi Code 凭据存储方式暂不支持');
    const name = (config.key || 'oauth/kimi-code').replace(/^oauth\//, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw quotaError('ECONFIG', 'Kimi Code 凭据引用无效');
    let data;
    try {
      const raw = await read(join(root, 'credentials', `${name}.json`), 'utf8');
      if (Buffer.byteLength(raw) > 64 * 1024) continue;
      data = JSON.parse(raw);
    } catch { continue; }
    if (typeof data.access_token !== 'string' || !data.access_token.trim() || /[\r\n]/.test(data.access_token)) continue;
    return { token: data.access_token, origin };
  }
  throw quotaError('ENOAUTH', '未找到 Kimi Code 登录，请在官方 CLI 中登录');
}

async function queryWithCredentialReread(auth, request, options) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const credential = await auth(options);
    try { return await request(credential); }
    catch (error) {
      if (error.code !== 'EAUTH' || attempt === 1) throw error;
      // Official desktop/CLI owns refresh-token rotation. Re-read its result, never race its writer.
    }
  }
}

export async function readKimiMembershipQuota({ auth = readKimiDesktopAuth, ...options } = {}) {
  const payload = await queryWithCredentialReread(auth, ({ token, origin }) => {
    if (!['https://www.kimi.com', 'https://www.kimi.ai'].includes(origin)) throw quotaError('EORIGIN', 'Kimi 登录所属服务不受支持');
    return quotaJson(origin + MEMBERSHIP_PATH, {
      ...options, headers: { Authorization: `Bearer ${token}`, 'Connect-Protocol-Version': '1' }, body: {},
    });
  }, options);
  const report = kimiMembershipReport(payload);
  if (!report) throw quotaError('ENODATA', 'Kimi 暂未返回可用额度');
  return report;
}

export async function readKimiCodeQuota({ auth = readKimiCodeAuth, ...options } = {}) {
  const payload = await queryWithCredentialReread(auth, ({ token, origin }) => {
    if (!CODE_ORIGINS.has(origin)) throw quotaError('EORIGIN', 'Kimi Code 服务地址不受支持');
    return quotaJson(origin + '/coding/v1/usages', { ...options, headers: { Authorization: `Bearer ${token}` } });
  }, options);
  const report = kimiCodeReport(payload);
  if (!report) throw quotaError('ENODATA', 'Kimi Code 暂未返回可用额度');
  return report;
}

export function createKimiQuotaCollector(options = {}) {
  return createProviderQuotaCollector({ read: readKimiMembershipQuota,
    installed: () => existsSync(process.env.MACLAWD_KIMI_DESKTOP_DIR || join(homedir(), 'Library/Application Support/kimi-desktop')),
    ...options });
}
/** A profile directory survives uninstall; require an actual standalone executable. */
export function isKimiCodeInstalled({ home = homedir(), env = process.env,
  executable = (path) => {
    try { return statSync(path).isFile() && (accessSync(path, constants.X_OK), true); }
    catch { return false; }
  },
} = {}) {
  if (env.MACLAWD_KIMI_CODE_BIN) return executable(env.MACLAWD_KIMI_CODE_BIN);
  const root = env.MACLAWD_KIMI_CODE_DIR || env.KIMI_CODE_HOME || join(home, '.kimi-code');
  const dirs = [join(root, 'bin'), join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin',
    ...(env.PATH || '').split(':').filter((p) => p.startsWith('/'))];
  return [...new Set(dirs)].some((dir) => ['kimi', 'kimi-code'].some((name) => executable(join(dir, name))));
}

export function createKimiCodeQuotaCollector({ settings = loadSettings, ...options } = {}) {
  return createProviderQuotaCollector({
    read: readKimiCodeQuota,
    enabled: () => {
      const current = settings();
      return usageEnabled(current) && current.quotaTracking === true && current.kimiCodeQuotaTracking === true;
    },
    installed: isKimiCodeInstalled,
    errorMessages: {
      EAUTH: '独立 Kimi Code CLI 的额度认证失败。如需读取，请在该 CLI 中执行 /login；不影响 Kimi 桌面版登录。',
      ENOAUTH: '未找到独立 Kimi Code CLI 登录；桌面版 Kimi 无需重新登录。',
      ENODATA: '独立 Kimi Code CLI 暂未返回额度；不影响 Kimi 桌面版额度。',
    },
    ...options,
  });
}
