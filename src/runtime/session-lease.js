import {
  mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { dataDir } from './paths.js';

/**
 * 会话租约：让「桌宠没开」不再等于「这段时间发生的事全丢了」。
 *
 * **原来的失败模式。** hook 把事件 POST 到 127.0.0.1，连不上就静默丢弃
 * （那条 catch 是刻意的——桌宠没开不该在用户的 agent 里留下错误）。
 * 代价是：先开 Claude Code 后开 Maclawd，前面那段全不存在；
 * 更常见的是我们自己重新打包重启一次，所有在跑的会话瞬间失忆，
 * 桌宠从 idle 开始，而屏幕另一头的任务还在跑。
 *
 * **改法。** hook 每次都往磁盘写一份租约，**不依赖服务在线**。
 * 运行时启动时读回来，把还站得住的会话恢复成在途状态。
 *
 * 「站得住」要两个证据一起看：
 *   · validUntil 还没过——一份写了两小时的租约不该复活
 *   · 那个进程还活着，而且**还是原来那个**——pid 会被系统回收复用，
 *     只比 pid 会把一个不相干的进程认成 agent
 *
 * 进程身份用启动时刻（sysctl 拿到的 p_starttime，秒级）。pid 复用要
 * 同一秒内发生才可能骗过它，那已经不是工程上需要担心的概率。
 *
 * 全部有界：单份 16KB、总共 200 份、超过 24 小时一律清掉。
 * 无界的磁盘状态迟早会变成一个没人记得的问题。
 */

const LEASE_DIR = 'session-leases';
const LEASE_VERSION = 1;
export const MAX_LEASE_BYTES = 16 * 1024;
export const MAX_LEASE_FILES = 200;
export const MAX_LEASE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 租约有效期。比 hook 事件的自然间隔长得多（长任务几分钟没事件是常态），
 * 又短到「昨天的会话」不会在今天早上复活。
 */
export const LEASE_TTL_MS = 15 * 60 * 1000;

/**
 * 只有这些状态值得恢复。
 *
 * idle / needs_owner 刻意不在里面，理由不同：
 *   · idle —— 恢复它没有意义，引擎本来就从 idle 开始
 *   · needs_owner —— 那是「有个对话框在等你」，而对话框属于 agent 进程的
 *     那一次运行。桌宠重启后把它复活，会指着一个可能已经被回答过的问题。
 */
export const SUSTAINED = new Set([
  'thinking', 'working', 'working.testing', 'working.building', 'working.retrying',
  'delegating', 'compacting',
]);

export function leaseDir() {
  return join(dataDir(), LEASE_DIR);
}

/** 会话 id → 文件名。只允许安全字符，其余一律编码——它要用作路径。 */
function leaseFile(sessionId, agentId = null) {
  const scoped = agentId ? `${agentId}:${sessionId}` : sessionId;
  const safe = String(scoped).replace(/[^A-Za-z0-9_-]/g, (c) =>
    `_${c.charCodeAt(0).toString(16)}`);
  return join(leaseDir(), `${safe.slice(0, 120)}.json`);
}

/**
 * 进程启动时刻，用来分辨「还是那个进程」与「pid 被复用了」。
 *
 * macOS 没有 /proc，走 ps 是唯一不写原生扩展的路子。这是**冷路径**
 * （只在写租约和恢复时各跑一次），不在事件热路径上。
 */
function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    // lstart 是人可读的启动时刻；同一个 pid 被复用后这个值一定不同
    const out = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

/** 写一份租约。任何失败都必须静默——它跑在 hook 里。 */
export function writeLease({
  sessionId, state, pid = null, cwd = null, agentId = null,
  now = Date.now(), ttlMs = LEASE_TTL_MS,
} = {}) {
  if (!sessionId || !SUSTAINED.has(state)) return null;
  const record = {
    version: LEASE_VERSION,
    sessionId: String(sessionId),
    agentId: typeof agentId === 'string' ? agentId : null,
    state,
    at: now,
    validUntil: now + ttlMs,
    pid: Number.isInteger(pid) && pid > 1 ? pid : null,
    identity: null,
    cwd: typeof cwd === 'string' ? cwd.slice(0, 1024) : null,
  };
  if (record.pid) record.identity = processIdentity(record.pid);

  const body = `${JSON.stringify(record)}\n`;
  if (body.length > MAX_LEASE_BYTES) return null;
  try {
    mkdirSync(leaseDir(), { recursive: true });
    const target = leaseFile(sessionId, agentId);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, target);
  } catch {
    return null;
  }
  return record;
}

/** 一个会话结束了，租约立刻作废。留着它会让下次启动复活一个已经没了的会话。 */
export function dropLease(sessionId, agentId = null) {
  if (!sessionId) return;
  try {
    rmSync(leaseFile(sessionId, agentId), { force: true });
  } catch {
    // 删不掉也没关系：validUntil 与进程身份检查会兜住
  }
}

function listLeaseFiles() {
  try {
    return readdirSync(leaseDir())
      .filter((n) => n.endsWith('.json'))
      .map((n) => join(leaseDir(), n));
  } catch {
    return [];
  }
}

/**
 * 读回所有还站得住的租约，顺手把站不住的清掉。
 *
 * @returns {{sessionId, state, at, pid, cwd}[]}
 */
export function readLeases({ now = Date.now(), aliveCheck = defaultAlive } = {}) {
  const files = listLeaseFiles();
  // 超量时先按修改时间丢最旧的。数量上界要在解析之前生效——
  // 不然一个失控的写入方能让启动路径去解析上万个文件。
  if (files.length > MAX_LEASE_FILES) {
    const byAge = files
      .map((f) => { try { return { f, t: statSync(f).mtimeMs }; } catch { return { f, t: 0 }; } })
      .sort((a, b) => a.t - b.t);
    for (const { f } of byAge.slice(0, files.length - MAX_LEASE_FILES)) {
      try { rmSync(f, { force: true }); } catch { /* 下次再说 */ }
    }
  }

  const alive = [];
  for (const file of listLeaseFiles()) {
    let record = null;
    try {
      const raw = readFileSync(file, 'utf8');
      if (raw.length <= MAX_LEASE_BYTES) record = JSON.parse(raw);
    } catch {
      record = null;
    }
    const keep = record
      && record.version === LEASE_VERSION
      && SUSTAINED.has(record.state)
      && Number.isFinite(record.validUntil)
      && now < record.validUntil
      && now - record.at < MAX_LEASE_AGE_MS
      && aliveCheck(record);
    if (keep) alive.push(record);
    else { try { rmSync(file, { force: true }); } catch { /* 下次再说 */ } }
  }
  return alive;
}

/** 进程还在，而且还是当初那个。 */
function defaultAlive(record) {
  // 没记下 pid 的租约只能靠 validUntil。这不是漏洞：一份 15 分钟内写的、
  // 状态是 working 的租约，本来就该被恢复。
  if (!record.pid) return true;
  try {
    process.kill(record.pid, 0);
  } catch (err) {
    if (err?.code !== 'EPERM') return false;
  }
  if (!record.identity) return true;
  return processIdentity(record.pid) === record.identity;
}
