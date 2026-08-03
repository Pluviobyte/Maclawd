import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { readJson, writeJson } from './store.js';

/**
 * 局域网只读镜像。
 *
 * 目标刻意收窄：**「主动打开手机看一眼」**，不是「离开时收到提醒」。
 * 后者需要 APNs、服务器和 Apple 开发者账号（测算见 design/phone-sync-reserved.md）；
 * 前者只要同一个 Wi-Fi 加一个页面，成本是零。先把便宜的做了，
 * 验证「你到底会不会在手机上看」，再决定要不要为「主动提醒」付那套代价。
 *
 * 四条约束：
 *
 * 1. **默认关闭。** 不开启时服务只绑 127.0.0.1，局域网里根本看不到。
 * 2. **只读。** 局域网来的请求一律拒绝任何写操作——手机不能碰你的机器。
 * 3. **令牌门控 + 轮换。** 配对令牌可随时重置；轮换保留一个宽限窗口，
 *    免得手机上正开着的页面立刻断掉。
 * 4. **令牌不进 settings.json。** 那个文件是给人看和手改的，密钥单独存。
 */

const TOKEN_FILE = 'lan-token.json';
const GRACE_MS = 10 * 60 * 1000;

/** 只读白名单。不在表里的路径，局域网一律拒绝。 */
const READ_ONLY_PATHS = new Set([
  '/', '/mobile', '/mobile.html',
  '/api/state', '/api/live', '/api/summary', '/api/actions',
  // 额度只读。写入（statusline 的上报）走 POST，authorize 里的 method 检查
  // 已经把局域网的一切非 GET 请求挡掉了，这里不需要额外防护。
  '/api/quota',
]);

function newToken() {
  return randomBytes(18).toString('base64url');
}

function load() {
  const stored = readJson(TOKEN_FILE, null);
  if (stored?.token) return stored;
  const fresh = { token: newToken(), previous: null, rotatedAt: Date.now() };
  writeJson(TOKEN_FILE, fresh);
  return fresh;
}

export function currentToken() {
  return load().token;
}

/** 轮换。旧令牌在宽限窗口内仍然有效，避免手机上开着的页面立刻失效。 */
export function rotateToken() {
  const stored = load();
  const next = {
    token: newToken(),
    previous: stored.token,
    rotatedAt: Date.now(),
  };
  writeJson(TOKEN_FILE, next);
  return next.token;
}

/** 彻底重置：旧令牌立即失效，已配对的手机需要重新扫码。 */
export function resetToken() {
  const next = { token: newToken(), previous: null, rotatedAt: Date.now() };
  writeJson(TOKEN_FILE, next);
  return next.token;
}

export function tokenValid(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const stored = load();
  if (candidate === stored.token) return true;
  if (
    stored.previous
    && candidate === stored.previous
    && Date.now() - stored.rotatedAt < GRACE_MS
  ) return true;
  return false;
}

export function isLoopback(address) {
  if (!address) return false;
  const clean = address.replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
}

/**
 * 判定一个请求是否放行。
 *
 * @returns {{allow: boolean, reason?: string, readOnly: boolean}}
 */
export function authorize({ remoteAddress, pathname, method, token, lanEnabled }) {
  // 本机永远放行，且可读可写——面板就跑在本机。
  if (isLoopback(remoteAddress)) return { allow: true, readOnly: false };

  if (!lanEnabled) return { allow: false, reason: '局域网镜像未开启', readOnly: true };
  if (!tokenValid(token)) return { allow: false, reason: '配对令牌无效', readOnly: true };

  // 局域网只读：手机不能对你的机器做任何事
  if (method !== 'GET') return { allow: false, reason: '局域网连接为只读', readOnly: true };
  const base = pathname.split('?')[0];
  if (!READ_ONLY_PATHS.has(base) && !base.startsWith('/src/animations/')) {
    return { allow: false, reason: '该路径不对局域网开放', readOnly: true };
  }
  return { allow: true, readOnly: true };
}

/** 局域网里可用的地址，用于生成配对链接。 */
export function lanAddresses() {
  const out = [];
  const interfaces = networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      out.push(entry.address);
    }
  }
  return out;
}

export function pairingUrls(port) {
  const token = currentToken();
  return lanAddresses().map((address) => `http://${address}:${port}/mobile?t=${token}`);
}
