import { mkdir, stat, utimes, rmdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { quotaError } from './quota-client.js';

// Official TS 99eaa993 (proper-lockfile 4.1.2) + Python 86f13642 (flock).
// Do not substitute Vibe's private refresh lock: it does not serialize with CLI.
const flights = new Map();
const clientId = '17e5f671-d194-4dfb-9706-5516cb48c098';
const lockError = () => quotaError('ELOCK', 'Kimi 登录正在刷新，稍后自动重试');
const fresh = (token, now) => !Number(token.expires_at)
  || Number(token.expires_at) - now / 1000 > Math.max(300, Number(token.expires_in || 0) * 0.5);

async function directoryLock(root, name, signal, lost) {
  const parent = join(root, 'oauth'), path = join(parent, `${name}.lock`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  let acquired;
  for (let attempt = 0; attempt < 50; attempt++) {
    signal.throwIfAborted();
    try { await mkdir(path, { mode: 0o700 }); acquired = await stat(path); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw lockError();
      // Same stale interval as proper-lockfile. Recheck identity/mtime before
      // removing an abandoned *empty directory*, never a live holder's lease.
      try {
        const old = await stat(path);
        if (old.isDirectory() && Date.now() - old.mtimeMs > 5000) {
          const current = await stat(path);
          if (current.ino === old.ino && current.mtimeMs === old.mtimeMs) { await rmdir(path);continue; }
        }
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw lockError(); }
      await delay(100, undefined, { signal });
    }
  }
  if (!acquired) throw lockError();
  let stamp = acquired.mtimeMs, pending = Promise.resolve();
  const verify = async () => {
    const current = await stat(path);
    if (current.ino !== acquired.ino || current.mtimeMs !== stamp) throw lockError();
  };
  // Official stale=5s. A 1s heartbeat stays below its 2.5s default interval.
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      await verify();const time = new Date();await utimes(path, time, time);stamp = (await stat(path)).mtimeMs;
    }).catch(() => lost.abort(lockError()));
  }, 1000);
  timer.unref?.();
  return { async verify() { await pending;signal.throwIfAborted();await verify(); }, async release() {
    clearInterval(timer);await pending;
    try { await verify();await rmdir(path); } catch { /* A different owner must retain its lock. */ }
  } };
}

function nativeHelper(env) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  return [env.MACLAWD_NATIVE_HELPER, join(repo, 'mac/.build/release/Maclawd'), join(repo, 'mac/.build/debug/Maclawd')]
    .filter(Boolean).find(path => { try { accessSync(path, constants.X_OK);return true; } catch { return false; } });
}
async function fileLock(context, signal, lost, env) {
  const binary = nativeHelper(env);
  if (!binary) throw quotaError('ELOCK', '刷新旧版 Kimi 登录需要 Maclawd 原生运行时');
  const child = spawn(binary, ['--credential-lock', join(context.root, 'credentials', `${context.name}.lock`)],
    { stdio: ['pipe', 'pipe', 'ignore'] });
  let released = false;
  const abort = () => child.kill('SIGKILL');
  signal.addEventListener('abort', abort, { once: true });
  child.stdin.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { abort();reject(lockError()); }, 6500);
      const fail = () => { clearTimeout(timer);if (!released) { lost.abort(lockError());reject(lockError()); } };
      child.once('error', fail);child.once('exit', fail);
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output === 'acquired\n') { clearTimeout(timer);resolve(); }
        else if (output.length > 128) fail();
      });
    });
    signal.throwIfAborted();
  } catch (error) { abort();signal.removeEventListener('abort', abort);throw error; }
  return () => { released = true;signal.removeEventListener('abort', abort);child.stdin.end(); };
}

function usable(data) { return typeof data?.access_token === 'string' && data.access_token.trim() && !/[\r\n]/.test(data.access_token); }
async function readToken(path) {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 64 * 1024) throw quotaError('ECONFIG', 'Kimi 登录文件过大');
  const data = JSON.parse(raw);
  if (!usable(data)) throw quotaError('ENOAUTH', 'Kimi 登录状态已改变');
  return { raw, data };
}
async function atomicSave(path, data) {
  const temporary = `${path}.maclawd-${randomUUID()}`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data) + '\n');await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function refreshKimiCredential(credential, { force = false, signal, fetchImpl = globalThis.fetch,
  now = Date.now, env = process.env } = {}) {
  const context = credential.refreshContext;
  if (!context || (!force && fresh(context.data, now()))) return credential;
  if (typeof context.data.refresh_token !== 'string' || !context.data.refresh_token.trim()) {
    if (force) throw quotaError('EAUTH', 'Kimi 登录无法自动刷新，请在官方 CLI 中重新登录');
    return credential;
  }
  if (flights.has(context.path)) return flights.get(context.path);
  const operation = (async () => {
    const lost = new AbortController();
    const combined = AbortSignal.any([lost.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    let lock, releaseFile;
    const adopt = data => Object.defineProperty({ token: data.access_token, origin: credential.origin },
      'refreshContext', { value: { ...context, data } });
    try {
      lock = await directoryLock(context.root, context.name, combined, lost);
      if (context.legacy) releaseFile = await fileLock(context, combined, lost, env);
      const before = await readToken(context.path);
      if (before.data.access_token !== context.data.access_token || before.data.refresh_token !== context.data.refresh_token
        || before.data.expires_at !== context.data.expires_at || (!force && fresh(before.data, now()))) return adopt(before.data);
      if (typeof before.data.refresh_token !== 'string' || !before.data.refresh_token.trim()) throw quotaError('EAUTH', 'Kimi 登录无法自动刷新，请在官方 CLI 中重新登录');
      const host = credential.origin === 'https://api.kimi.ai' ? 'https://auth.kimi.ai'
        : credential.origin === 'https://api.kimi.com' ? 'https://auth.kimi.com' : null;
      if (!host) throw quotaError('EORIGIN', 'Kimi 登录地区无效');
      const response = await fetchImpl(host + '/api/oauth/token', {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: before.data.refresh_token }),
      });
      combined.throwIfAborted();
      if (!response.ok) {
        const peer = await readToken(context.path);
        if (peer.raw !== before.raw) return adopt(peer.data);
        throw quotaError(response.status === 401 || response.status === 403 || response.status === 400 ? 'EAUTH'
          : response.status === 429 ? 'ERATELIMIT' : 'EHTTP', 'Kimi 登录刷新失败，将保留原登录并稍后重试');
      }
      const chunks = [];let size = 0;
      if (!response.body) throw quotaError('EPROTO', 'Kimi 刷新响应为空');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 64 * 1024) throw quotaError('EPROTO', 'Kimi 刷新响应过大');
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let result;try { result = JSON.parse(raw); } catch { throw quotaError('EPROTO', 'Kimi 刷新响应无效'); }
      if (!usable(result) || typeof result.refresh_token !== 'string' || !result.refresh_token.trim()
        || !Number.isFinite(Number(result.expires_in)) || Number(result.expires_in) <= 0) throw quotaError('EPROTO', 'Kimi 刷新响应不完整');
      const data = { ...before.data, access_token: result.access_token, refresh_token: result.refresh_token,
        expires_in: Number(result.expires_in), expires_at: now() / 1000 + Number(result.expires_in),
        scope: result.scope ?? before.data.scope, token_type: result.token_type ?? before.data.token_type };
      await lock.verify();
      const peer = await readToken(context.path);
      if (peer.raw !== before.raw) return adopt(peer.data);
      combined.throwIfAborted();await atomicSave(context.path, data);
      return adopt(data);
    } catch (error) {
      if (signal?.aborted) throw quotaError('EABORT', 'Kimi 登录刷新已取消');
      if (lost.signal.aborted) throw lockError();
      if (combined.aborted) throw quotaError('ETIMEDOUT', 'Kimi 登录刷新超时');
      if (['EAUTH','ENOAUTH','EORIGIN','ELOCK','ECONFIG','EPROTO','ERATELIMIT','EHTTP'].includes(error.code)) throw error;
      throw quotaError('ENETWORK', 'Kimi 登录刷新失败，原登录未被覆盖');
    } finally { releaseFile?.();await lock?.release(); }
  })();
  flights.set(context.path, operation);
  try { return await operation; } finally { flights.delete(context.path); }
}
