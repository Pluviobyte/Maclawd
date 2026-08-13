/**
 * Grok Build 的 gRPC-web 计费端点 → Maclawd 通用额度上报。
 *
 * 读取 ~/.grok/auth.json 里的 Bearer Token，向 grok.com 的
 * GetGrokCreditsConfig 发一个空帧，从 protobuf 响应里扫出
 * usedPercent（float32）和 resetsAt（varint epoch 秒）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { grokHome } from './parsers/grok.js';
import { recordQuota } from './account-quota.js';
import { loadSettings } from './settings.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;
const BILLING_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';
const EMPTY_GRPC_FRAME = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);

function quotaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * OIDC scope（`https://auth.x.ai::` 开头）优先于 legacy（`https://accounts.x.ai/sign-in`）。
 * 取 entry 的 `key` 字段作为 Bearer Token。
 */
export function readGrokToken({ authPath } = {}) {
  const file = authPath ?? join(grokHome(), 'auth.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw quotaError('ENOAUTH', `未找到 Grok 认证文件：${file}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw quotaError('ENOAUTH', 'Grok 认证文件格式无效');
  }
  if (!data || typeof data !== 'object') {
    throw quotaError('ENOAUTH', 'Grok 认证文件内容为空');
  }

  let oidcToken = null;
  let legacyToken = null;
  for (const [scope, entry] of Object.entries(data)) {
    const key = typeof entry?.key === 'string' ? entry.key.trim() : null;
    if (!key) continue;
    if (scope.startsWith('https://auth.x.ai::')) {
      oidcToken = key;
    } else if (scope === 'https://accounts.x.ai/sign-in' && !legacyToken) {
      legacyToken = key;
    }
  }
  const token = oidcToken ?? legacyToken;
  if (!token) throw quotaError('ENOAUTH', 'Grok 认证文件中未找到有效 Token');
  return token;
}

/**
 * 从 gRPC-web protobuf 响应体中扫描 usedPercent 和 resetsAt。
 *
 * wire type 5（fixed32）→ 读 4 字节 float32 LE，0 ≤ val ≤ 100 视为 usedPercent 候选；
 * wire type 0（varint）→ 解码后若在合理的 epoch 秒范围内视为 resetsAt 候选。
 */
export function parseGrpcBillingResponse(buffer) {
  if (buffer.length < 5) throw quotaError('EPROTO', 'gRPC 响应过短');
  const frameLength = buffer.readUInt32BE(1);
  if (5 + frameLength > buffer.length) throw quotaError('EPROTO', 'gRPC 帧长度超出响应');
  const proto = buffer.subarray(5, 5 + frameLength);

  let usedPercent = null;
  let resetsAt = null;

  // 递归扫描所有层级，float32 和 varint 候选可能在任意嵌套深度
  function scan(buf) {
    let offset = 0;
    while (offset < buf.length) {
      const tagResult = decodeVarint(buf, offset);
      if (!tagResult) break;
      offset = tagResult.offset;
      const wireType = tagResult.value & 0x07;

      if (wireType === 0) {
        const varintResult = decodeVarint(buf, offset);
        if (!varintResult) break;
        offset = varintResult.offset;
        const value = varintResult.value;
        if (resetsAt === null && value > 1_700_000_000 && value < 2_100_000_000) {
          resetsAt = value;
        }
      } else if (wireType === 1) {
        if (offset + 8 > buf.length) break;
        offset += 8;
      } else if (wireType === 2) {
        const lenResult = decodeVarint(buf, offset);
        if (!lenResult) break;
        offset = lenResult.offset;
        if (offset + lenResult.value > buf.length) break;
        const sub = buf.subarray(offset, offset + lenResult.value);
        offset += lenResult.value;
        if (sub.length > 0) scan(sub);
      } else if (wireType === 5) {
        if (offset + 4 > buf.length) break;
        const floatVal = buf.readFloatLE(offset);
        offset += 4;
        if (usedPercent === null && Number.isFinite(floatVal)
            && floatVal >= 0 && floatVal <= 100) {
          usedPercent = floatVal;
        }
      } else {
        break;
      }
    }
  }

  scan(proto);
  return { usedPercent, resetsAt };
}

function decodeVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    value |= (byte & 0x7F) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset };
    shift += 7;
    if (shift >= 35) break;
  }
  return null;
}

export async function readGrokBilling({
  signal = null,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  authPath,
} = {}) {
  if (typeof fetchImpl !== 'function') throw quotaError('ENETWORK', '当前运行时不支持网络请求');

  const token = readGrokToken({ authPath });

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(BILLING_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        'x-grpc-web': '1',
        'x-user-agent': 'connect-es/2.1.1',
        // Cloudflare 1010 会拦截没有 User-Agent 的请求
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Origin: 'https://grok.com',
        Referer: 'https://grok.com/?_s=usage',
        Authorization: `Bearer ${token}`,
      },
      body: EMPTY_GRPC_FRAME,
      signal: controller.signal,
    });

    if (!response?.ok) {
      const code = response?.status === 401 || response?.status === 403 ? 'EAUTH' : 'EHTTP';
      throw quotaError(code, code === 'EAUTH'
        ? 'Grok 登录状态已失效'
        : `Grok 计费服务返回 HTTP ${response?.status ?? '?'}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
      throw quotaError('EOVERFLOW', 'Grok 计费响应过大');
    }
    const buffer = Buffer.from(arrayBuffer);
    const { usedPercent, resetsAt } = parseGrpcBillingResponse(buffer);

    if (usedPercent === null) {
      throw quotaError('ENODATA', 'Grok 计费响应中未找到用量百分比');
    }

    const now = Date.now();
    const resetsAtMs = resetsAt !== null ? resetsAt * 1000 : null;
    // 过去的 resetsAt 不可能是「下次重置」，丢弃
    const validResetAt = resetsAtMs !== null && resetsAtMs > now ? resetsAtMs : null;

    return {
      source: 'grok',
      sourceLabel: 'Grok Build',
      completeSnapshot: true,
      windows: {
        billing_cycle: {
          usedPercent,
          resetAt: validResetAt,
          label: '计费周期',
        },
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) {
        const aborted = quotaError('EABORT', 'Grok 额度读取已取消');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw quotaError('ETIMEDOUT', 'Grok 额度读取超时');
    }
    throw error?.code ? error : quotaError('ENETWORK', '无法连接 Grok 计费服务');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

export function createGrokQuotaCollector({
  intervalMs = DEFAULT_REFRESH_MS,
  enabled = () => loadSettings().quotaTracking === true,
  read = readGrokBilling,
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
            ? error.message.slice(0, 160) : 'Grok 额度读取失败',
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
