/** Shared transport for read-only quota queries. Never expose response bodies or credentials. */
export function quotaError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}

export async function quotaJson(url, {
  headers = {}, body, signal, timeoutMs = 15_000, fetchImpl = globalThis.fetch,
} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw quotaError('EAUTH', '登录状态已失效，请在官方应用中刷新登录');
    if (response.status === 429) throw quotaError('ERATELIMIT', '额度查询过于频繁，请稍后再试');
    if (!response.ok) throw quotaError('EHTTP', `额度服务返回 HTTP ${Number(response.status) || 0}`);
    const chunks = [];
    let length = 0;
    if (!response.body) throw quotaError('EPROTO', '额度服务未返回数据');
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) {
        controller.abort();
        throw quotaError('EPROTO', '额度响应超过大小限制');
      }
      chunks.push(Buffer.from(chunk));
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw quotaError('EPROTO', '额度响应格式无效'); }
    if (payload?.code === 'unauthenticated' || payload?.code === 'permission_denied') throw quotaError('EAUTH', '官方服务拒绝了当前登录');
    return payload;
  } catch (error) {
    if (error?.code && ['EAUTH', 'ERATELIMIT', 'EHTTP', 'EPROTO'].includes(error.code)) throw error;
    if (signal?.aborted) throw quotaError('EABORT', '额度查询已取消');
    if (controller.signal.aborted) throw quotaError('ETIMEDOUT', '额度查询超时');
    throw quotaError('ENETWORK', '无法连接官方额度服务');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
