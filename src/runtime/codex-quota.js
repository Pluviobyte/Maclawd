/**
 * Codex app-server 的 rate-limit snapshot → Maclawd 通用额度上报。
 *
 * primary / secondary 只是协议槽位，不代表 5 小时 / 本周。
 * 必须用 windowDurationMins 判断，否则只返回周窗口的账号会被错标。
 */

import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { recordQuota } from './account-quota.js';
import { loadSettings } from './settings.js';

const MAX_PROTOCOL_BYTES = 2 * 1024 * 1024;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function windowIdentity(durationMinutes, slot) {
  if (durationMinutes === 300) return { id: 'five_hour', label: '5 小时' };
  if (durationMinutes === 10_080) return { id: 'seven_day', label: '本周' };
  if (Number.isInteger(durationMinutes) && durationMinutes > 0) {
    let label;
    if (durationMinutes < 60) label = `${durationMinutes} 分钟`;
    else if (durationMinutes % (24 * 60) === 0) label = `${durationMinutes / (24 * 60)} 天`;
    else if (durationMinutes % 60 === 0) label = `${durationMinutes / 60} 小时`;
    else label = `${durationMinutes} 分钟`;
    return { id: `duration_${durationMinutes}`, label };
  }
  return { id: `codex_${slot}`, label: '额度窗口' };
}

function reportForBucket(limitId, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const windows = {};
  const candidates = ['primary', 'secondary']
    .map((slot) => ({ slot, window: snapshot[slot] }))
    .filter(({ window }) => finite(window?.usedPercent) !== null)
    .sort((a, b) => (finite(a.window.windowDurationMins) ?? Infinity)
      - (finite(b.window.windowDurationMins) ?? Infinity));

  for (const { slot, window } of candidates) {
    const durationMinutes = finite(window.windowDurationMins);
    const identity = windowIdentity(durationMinutes, slot);
    const entry = {
      label: identity.label,
      durationMinutes,
      usedPercent: window.usedPercent,
      resetAt: finite(window.resetsAt) === null ? null : window.resetsAt * 1000,
    };
    windows[identity.id] = entry;
  }
  const isDefault = limitId === 'codex';
  const rawName = typeof snapshot.limitName === 'string' && snapshot.limitName.trim()
    ? snapshot.limitName.trim()
    : limitId;
  return {
    source: isDefault ? 'codex' : `codex:${limitId}`,
    sourceLabel: isDefault ? 'Codex' : `Codex · ${rawName}`,
    planType: typeof snapshot.planType === 'string' ? snapshot.planType : null,
    completeSnapshot: true,
    windows,
  };
}

export function codexRateLimitReports(result) {
  if (!result || typeof result !== 'object') return [];
  const byId = result.rateLimitsByLimitId;
  // 官方兼容规则只把 `codex` 作为 ChatGPT 订阅额度。其它 limitId
  // 可能是独立计量的模型池，不能伪装成另一份“订阅”。
  const snapshot = byId && typeof byId === 'object' && byId.codex
    ? byId.codex
    : result.rateLimits;
  const report = reportForBucket('codex', snapshot);
  return report ? [report] : [];
}

/**
 * 启动一个短命官方 app-server，只做一次读取就退出。
 * stdout 是 JSONL 协议，stderr 不得混入解析。
 */
export function readCodexRateLimits({
  command,
  timeoutMs = 10_000,
  spawnImpl = spawn,
  signal = null,
} = {}) {
  if (!command) {
    const error = new Error('未找到 Codex CLI');
    error.code = 'ENOENT';
    return Promise.reject(error);
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    let settled = false;
    let finishing = false;
    let exited = false;
    let killTimer = null;
    let settleTimer = null;
    let terminalError = null;
    let terminalValue;
    let buffer = '';
    let protocolBytes = 0;

    const timer = setTimeout(() => {
      const error = new Error(`Codex 额度读取超时（${timeoutMs}ms）`);
      error.code = 'ETIMEDOUT';
      finish(error);
    }, timeoutMs);
    timer.unref?.();

    function deliver() {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (settleTimer) clearTimeout(settleTimer);
      if (terminalError) rejectPromise(terminalError);
      else resolvePromise(terminalValue);
    }

    function onAbort() {
      const error = new Error('Codex 额度读取已取消');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      finish(error);
    }

    function finish(error, value) {
      if (settled || finishing) return;
      finishing = true;
      terminalError = error ?? null;
      terminalValue = value;
      clearTimeout(timer);
      try { child?.stdin?.end(); } catch { /* 尽力而为 */ }
      if (!child || exited) {
        deliver();
        return;
      }
      try { child.kill('SIGTERM'); } catch { /* 尽力而为 */ }
      killTimer = setTimeout(() => {
        if (!exited) {
          try { child.kill('SIGKILL'); } catch { /* 尽力而为 */ }
        }
      }, 250);
      killTimer.unref?.();
      // 即使异常的 spawn 实现从不发 exit，也必须有界地完成 Promise。
      settleTimer = setTimeout(deliver, 750);
      settleTimer.unref?.();
    }

    function send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function handle(message) {
      if (message?.id === 1) {
        if (message.error) {
          const error = new Error(message.error.message ?? 'Codex app-server 初始化失败');
          error.code = 'CODEX_RPC_ERROR';
          error.rpcCode = message.error.code;
          finish(error);
          return;
        }
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/rateLimits/read' });
      } else if (message?.id === 2) {
        if (message.error) {
          const error = new Error(message.error.message ?? 'Codex 额度读取失败');
          error.code = 'CODEX_RPC_ERROR';
          error.rpcCode = message.error.code;
          finish(error);
          return;
        }
        finish(null, message.result);
      }
    }

    try {
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      child = spawnImpl(command, ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      // 必须消费 stderr，否则子进程写满 pipe 会卡住；不落盘避免泄露账户元数据。
      child.stderr.on('data', () => {});
      child.stdin.on?.('error', (error) => {
        // 正常收尾时关闭 stdin 也可能收到 EPIPE；结果已确定时无需覆盖。
        if (!finishing) finish(error);
      });
      child.stdout.on('data', (chunk) => {
        if (settled || finishing) return;
        protocolBytes += Buffer.byteLength(chunk);
        if (protocolBytes > MAX_PROTOCOL_BYTES) {
          const error = new Error('Codex app-server 协议输出过大');
          error.code = 'EOVERFLOW';
          finish(error);
          return;
        }
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            handle(JSON.parse(line));
          } catch {
            const error = new Error('Codex app-server 返回了无法解析的协议数据');
            error.code = 'EPROTO';
            finish(error);
          }
        }
      });
      child.once('error', finish);
      child.once('exit', (code) => {
        exited = true;
        if (finishing) {
          deliver();
        } else if (!settled) {
          const error = new Error(`Codex app-server 提前退出（${code ?? '?'}）`);
          error.code = 'ECHILD';
          finish(error);
        }
      });
      send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'maclawd', title: 'Maclawd', version: '0.1.0' } },
      });
    } catch (error) {
      finish(error);
    }
  });
}

/** GUI 进程的 PATH 往往没有 Homebrew，所以已知安装位置要显式探测。 */
export function findCodexExecutable({ env = process.env } = {}) {
  const pathCandidates = (env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, 'codex'));
  const candidates = [
    env.MACLAWD_CODEX_BIN,
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.local', 'bin', 'codex'),
    ...pathCandidates,
  ].filter(Boolean);

  for (const candidate of new Set(candidates)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 继续尝试下一个已知位置
    }
  }
  return null;
}

/**
 * Codex 额度的独立采集器。十分钟缓存对小时/天级窗口足够，
 * 并且 refresh 本身合并并发调用，不会为了两个界面起两个子进程。
 */
export function createCodexQuotaCollector({
  intervalMs = DEFAULT_REFRESH_MS,
  enabled = () => loadSettings().quotaTracking === true,
  command = () => findCodexExecutable(),
  read = readCodexRateLimits,
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
        const executable = typeof command === 'function' ? command() : command;
        const result = await read({ command: executable, signal: controller.signal });
        const reports = codexRateLimitReports(result);
        if (reports.length === 0) {
          const error = new Error('Codex 暂未返回额度窗口');
          error.code = 'ENODATA';
          throw error;
        }
        // 读取期间用户可能已关闭开关，或 server 已 stop。旧结果不得落盘。
        if (!enabled() || refreshLifecycle !== lifecycle) return { discarded: true };
        for (const report of reports) record(report);
        lastSuccessAt = Date.now();
        lastError = null;
        return { reports: reports.length, lastSuccessAt };
      } catch (error) {
        if (controller.signal.aborted || refreshLifecycle !== lifecycle) {
          return { discarded: true };
        }
        lastError = { code: error?.code ?? null, message: error?.message ?? String(error) };
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
