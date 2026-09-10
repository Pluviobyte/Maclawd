import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { queryDbJson } from './parsers/sqlite.js';
import { quotaError } from './quota-client.js';

const SERVICES = { kimi: 'kimi-desktop Safe Storage', 'doubao-work': 'DoubaoWork Safe Storage' };

/** Invoke Apple's existing Keychain reader; keep its output in a private pipe, never an error/log. */
export function readDesktopStoragePassword(provider, { signal, run = execFile, platform = process.platform } = {}) {
  const service = SERVICES[provider];
  if (!service || platform !== 'darwin') return Promise.reject(quotaError('EUNSUPPORTED', '当前平台不支持桌面登录读取'));
  if (signal?.aborted) return Promise.reject(quotaError('EABORT', '额度查询已取消'));
  return new Promise((resolve, reject) => {
    run('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'buffer', timeout: 5_000, maxBuffer: 16_384, signal,
    }, (error, stdout) => {
      if (error || !stdout?.length) {
        if (Buffer.isBuffer(stdout)) stdout.fill(0);
        reject(quotaError(signal?.aborted ? 'EABORT' : 'EKEYCHAIN', signal?.aborted
          ? '额度查询已取消' : '无法读取应用钥匙串登录，请检查 macOS 钥匙串访问权限'));
        return;
      }
      // security appends one newline; whitespace can otherwise be part of the secret.
      const bytes = Buffer.from(stdout);
      if (Buffer.isBuffer(stdout)) stdout.fill(0);
      resolve(bytes.at(-1) === 10 ? bytes.subarray(0, -1) : bytes);
    });
  });
}

/** Chromium/Electron macOS v10. Cookie v24+ binds ciphertext to the exact host_key. */
export function decryptMacStorage(ciphertext, password, { cookieVersion = 0, hostKey } = {}) {
  let key;
  let plaintext;
  try {
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 19 || ciphertext.subarray(0, 3).toString() !== 'v10') {
      throw new Error();
    }
    key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(3)), decipher.final()]);
    let offset = 0;
    if (cookieVersion >= 24) {
      if (typeof hostKey !== 'string' || plaintext.length < 32
        || !timingSafeEqual(plaintext.subarray(0, 32), createHash('sha256').update(hostKey).digest())) throw new Error();
      offset = 32;
    }
    return plaintext.subarray(offset).toString('utf8');
  } catch { throw quotaError('EDECRYPT', '应用登录存储无法解密或格式不受支持'); }
  finally { key?.fill(0); plaintext?.fill(0); }
}

export async function readKimiDesktopAuth({
  home = homedir(), signal, read = readFile, password = readDesktopStoragePassword,
  profileDir = process.env.MACLAWD_KIMI_DESKTOP_DIR || join(home, 'Library/Application Support/kimi-desktop'),
} = {}) {
  let data;
  try {
    const raw = await read(join(profileDir, 'bridge-store/token-store.json'), 'utf8');
    if (Buffer.byteLength(raw) > 64 * 1024) throw new Error();
    data = JSON.parse(raw);
  } catch { throw quotaError('ENOAUTH', '未找到 Kimi 桌面登录'); }
  if (data.encryption !== 'safeStorage.v1' || typeof data.data !== 'string') throw quotaError('EDECRYPT', 'Kimi 桌面登录格式不受支持');
  const secret = await password('kimi', { signal });
  let value;
  try { value = JSON.parse(decryptMacStorage(Buffer.from(data.data, 'base64'), secret)); }
  catch (error) { throw error.code ? error : quotaError('EDECRYPT', 'Kimi 桌面登录格式无效'); }
  finally { secret.fill(0); }
  // A consumer token must never be sent to an arbitrary origin from a local config file.
  if (!['https://www.kimi.com', 'https://www.kimi.ai'].includes(value.origin)) {
    throw quotaError('EORIGIN', 'Kimi 登录所属地区或服务地址不受支持');
  }
  const token = value.tokens?.access_token;
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw quotaError('ENOAUTH', 'Kimi 桌面尚未登录');
  return { token, origin: value.origin };
}

export async function readDoubaoWorkAuth({
  home = homedir(), signal, query = queryDbJson, password = readDesktopStoragePassword,
  profileDir = process.env.MACLAWD_DOUBAO_WORK_DIR || join(home, 'Library/Application Support/DoubaoWork'),
} = {}) {
  const db = join(profileDir, 'Default/Cookies');
  let rows;
  let version;
  try {
    version = Number(query(db, "SELECT value FROM meta WHERE key='version'")[0]?.value);
    rows = query(db, "SELECT host_key,name,value,hex(encrypted_value) AS encrypted FROM cookies WHERE host_key='.doubao.com' AND name IN ('sessionid','passport_csrf_token')");
  } catch { throw quotaError('ENOAUTH', '未找到豆包工作登录'); }
  if (!Number.isInteger(version) || version < 1) throw quotaError('EPROTO', '豆包工作 Cookie 版本无法识别');
  if (!rows.some((row) => row.name === 'sessionid')) throw quotaError('ENOAUTH', '豆包工作尚未登录');
  let secret;
  const cookies = {};
  try {
    for (const row of rows) {
      if (row.host_key !== '.doubao.com' || !['sessionid', 'passport_csrf_token'].includes(row.name)) continue;
      let value = row.value;
      if (row.encrypted) {
        secret ??= await password('doubao-work', { signal });
        value = decryptMacStorage(Buffer.from(row.encrypted, 'hex'), secret, { cookieVersion: version, hostKey: row.host_key });
      }
      if (typeof value === 'string' && value && !/[\r\n;]/.test(value)) cookies[row.name] = value;
    }
  } finally { secret?.fill(0); }
  if (!cookies.sessionid) throw quotaError('ENOAUTH', '豆包工作登录不可用');
  return { session: cookies.sessionid, csrf: cookies.passport_csrf_token ?? null };
}
