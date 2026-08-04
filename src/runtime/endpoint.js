import {
  chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.js';

/**
 * 运行时端点发现。
 *
 * **为什么不能把端口写死。** 4173 是 Vite preview 的默认端口，而我们的用户
 * 就是开着 Vite 的人。此前 serve() 的 listen 没有错误处理，端口被占时抛出
 * 未捕获的 EADDRINUSE，**整个运行时进程直接退出**；外壳又把子进程的 stderr
 * 接到了 /dev/null，于是用户看到的是「桌宠不动，没有任何提示」——
 * 一个看起来像「这软件是坏的」的失败模式，实际只是端口撞了。
 *
 * 改成：运行时自己找一个能用的端口，然后把端口写进这个文件；
 * hook 和外壳去读，而不是各自写死一个常量。
 *
 * 文件放在 dataDir 下，卸载即净（token-tracking.md 原则 6）。
 */

export const ENDPOINT_FILE = 'runtime-endpoint.json';

export function endpointPath() {
  return join(dataDir(), ENDPOINT_FILE);
}

/** 端点文件多久算过期。进程被 kill -9 时文件会留下，靠这个兜底。 */
export const ENDPOINT_STALE_MS = 60_000;

export function writeEndpoint({ port, pid = process.pid, now = Date.now(), identity = null }) {
  if (!Number.isInteger(port) || port <= 0) return null;
  const record = {
    version: 2,
    port,
    pid,
    at: now,
    ...(identity ? {
      protocolVersion: identity.protocolVersion,
      buildId: identity.buildId,
      instanceId: identity.instanceId,
      managementToken: identity.managementToken,
      startedAt: identity.startedAt,
    } : {}),
  };
  try {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    // 先写临时文件再改名：hook 可能正好在读，不能让它看见半个 JSON。
    const target = endpointPath();
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    // rename 在同一文件系统内是原子的：hook 要么读到旧的完整内容，
    // 要么读到新的完整内容，不会读到写了一半的 JSON。
    renameSync(tmp, target);
    chmodSync(target, 0o600);
  } catch {
    // 写不进去不影响服务本身跑——退化成「hook 用默认端口」。
    return null;
  }
  return record;
}

export function readEndpoint({ now = Date.now(), maxAgeMs = ENDPOINT_STALE_MS } = {}) {
  let raw;
  try {
    raw = readFileSync(endpointPath(), 'utf8');
  } catch {
    return null;
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record || !Number.isInteger(record.port) || record.port <= 0) return null;
  // 陈旧判定用**两个**证据：时间戳与进程是否还活着。只看时间戳的话，
  // 一个跑了一整天的健康运行时会被当成过期（我们只在启动时写一次）；
  // 只看 pid 的话，pid 复用会让一个无关进程冒充运行时。
  if (Number.isFinite(record.at) && now - record.at > maxAgeMs && !alive(record.pid)) {
    return null;
  }
  return record;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0 只做权限与存在性检查，不真的发信号
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = 进程在，只是不属于我们
    return err?.code === 'EPERM';
  }
}

export function clearEndpoint({ instanceId = null } = {}) {
  try {
    if (instanceId && readEndpoint()?.instanceId !== instanceId) return;
    rmSync(endpointPath(), { force: true });
  } catch {
    // 清不掉就算了，readEndpoint 的存活检查会兜住
  }
}

/**
 * hook 用的端口发现。优先级刻意是：
 *   显式环境变量 > 端点文件 > 默认端口
 * 环境变量排第一是为了让测试与多实例调试有一个确定的入口。
 */
export function discoverPort({ fallback = 4173, env = process.env } = {}) {
  const explicit = Number(env?.MACLAWD_PORT);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const record = readEndpoint();
  if (record) return record.port;
  return fallback;
}
