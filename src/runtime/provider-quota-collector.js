import { recordQuota } from './account-quota.js';
import { loadSettings } from './settings.js';

/** Bounded polling, including errors: opening the panel must not repeatedly read Keychain. */
export function createProviderQuotaCollector({
  read, record = recordQuota, enabled = () => loadSettings().quotaTracking === true,
  intervalMs = 10 * 60_000, now = Date.now, installed = () => true, errorMessages = {},
} = {}) {
  let timer = null;
  let stopped = true;
  let generation = 0;
  let flight = null;
  let controller = null;
  let lastAttemptAt = null;
  let lastSuccessAt = null;
  let lastError = null;

  function refresh({ force = false } = {}) {
    if (!enabled()) return Promise.resolve({ disabled: true });
    if (flight) return flight;
    if (!force && lastAttemptAt !== null && now() - lastAttemptAt < intervalMs) return Promise.resolve({ cached: true, lastSuccessAt });
    const epoch = generation;
    const abort = new AbortController();
    controller = abort;
    lastAttemptAt = now();
    const task = Promise.resolve().then(() => read({ signal: abort.signal })).then((report) => {
      if (abort.signal.aborted || epoch !== generation || !enabled()) return { discarded: true };
      if (!report || !Object.keys(report.windows ?? {}).length) throw Object.assign(new Error(), { code: 'ENODATA' });
      record(report);
      lastSuccessAt = now();
      lastError = null;
      return { reports: 1, lastSuccessAt };
    }).catch((error) => {
      if (abort.signal.aborted || epoch !== generation || !enabled()) return { discarded: true };
      const messages = {
        ENOAUTH: '尚未发现官方应用登录', EAUTH: '登录已过期，请在官方应用中刷新登录',
        EKEYCHAIN: '钥匙串登录不可用，请检查 macOS 访问权限', EDECRYPT: '应用登录存储无法读取',
        EORIGIN: '登录所属服务地址不受支持', EUNSUPPORTED: '当前平台不支持此登录来源',
        ECONFIG: '官方应用登录配置格式暂不支持',
        ENODATA: '官方服务暂未返回可用额度', EPROTO: '官方额度响应格式不受支持',
        ETIMEDOUT: '额度查询超时', ERATELIMIT: '额度查询受到限流', EREMOTE: '官方服务拒绝额度查询',
        EHTTP: '官方额度服务暂不可用', ENETWORK: '无法连接官方额度服务',
      };
      const code = Object.hasOwn(messages, error?.code) ? error.code : 'EUNKNOWN';
      // No raw Error, stack, stdout, headers or server response can reach /api/quota.
      lastError = { code, message: errorMessages[code] ?? messages[code] ?? '额度读取失败' };
      return { error: lastError };
    }).finally(() => {
      if (flight === task) flight = null;
      if (controller === abort) controller = null;
    });
    flight = task;
    return task;
  }
  return {
    refresh,
    start() {
      if (!stopped) return;
      stopped = false;
      generation++;
      void refresh({ force: true });
      timer = setInterval(() => { void refresh(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      stopped = true; generation++; controller?.abort();
      controller = null; flight = null;
      clearInterval(timer); timer = null;
    },
    status: () => ({ enabled: enabled(), installed: installed(), running: !stopped, refreshing: Boolean(flight), lastAttemptAt, lastSuccessAt, lastError }),
  };
}
