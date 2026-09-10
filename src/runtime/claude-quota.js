import { spawn } from 'node:child_process';
import { accessSync, constants, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { recordQuota } from './account-quota.js';
import { loadSettings, usageEnabled } from './settings.js';

// Verified against official Agent SDK 0.3.267 and vibe-usage-app 34d5075 (v0.5.10).
// No user message is sent. The official binary owns OAuth/keychain and token renewal.
export const CLAUDE_QUOTA_ARGS = Object.freeze([
  '--print', '--safe-mode', '--no-session-persistence', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}', '--tools', '',
  '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
  // Upstream pending #40: settings.env can reintroduce this after process startup.
  // Override only in this process; "0" is truthy, so use an empty string.
  '--settings', '{"env":{"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":""}}',
]);
const ERROR_MESSAGES = {
  ENOCLI: '未找到 Claude Code，请安装 CLI 或 Claude 桌面应用',
  ENOTAPPLICABLE: '当前 Claude 登录不提供订阅额度，请检查官方应用登录',
  ENODATA: 'Claude 暂未返回额度，请检查官方应用登录或稍后重试',
  EPROTO: '当前 Claude Code 额度协议暂不支持，请更新官方应用',
  ETIMEDOUT: 'Claude 额度查询超时，将自动重试',
  EPROCESS: 'Claude 额度查询进程未能完成，将自动重试',
  EABORT: 'Claude 额度查询已取消',
};
function failure(code) { return Object.assign(new Error(ERROR_MESSAGES[code]), { code }); }

export function claudeQuotaEnvironment(env = process.env) {
  const result = { ...env };
  for (const key of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID']) {
    delete result[key];
  }
  return result;
}

export function discoverClaudeBinaries({ home = homedir(), env = process.env,
  executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } },
  list = (path) => { try { return readdirSync(path); } catch { return []; } },
  canonical = (path) => { try { return realpathSync(path); } catch { return path; } },
} = {}) {
  // An explicit override is exclusive, including when absent: useful for isolated runtimes/tests.
  if (env.MACLAWD_CLAUDE_BIN) {
    const path = env.MACLAWD_CLAUDE_BIN.replace(/^~\//, `${home}/`);
    return isAbsolute(path) && executable(path) ? [path] : [];
  }
  const paths = [join(home, '.local/bin/claude'), join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  const root = join(home, 'Library/Application Support/Claude/claude-code');
  const versions = list(root).filter((v) => /^\d+(?:\.\d+)+$/.test(v))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const version of versions) {
    const path = join(root, version, 'claude.app/Contents/MacOS/claude');
    if (executable(path)) { paths.push(path); break; }
  }
  paths.push('/Applications/Claude.app/Contents/Resources/bin/claude');
  const seen = new Set();
  return paths.filter((path) => {
    if (!executable(path)) return false;
    const id = canonical(path);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
}

export function claudeQuotaReport(payload) {
  if (payload?.rate_limits_available === false) throw failure('ENOTAPPLICABLE');
  const limits = payload?.rate_limits;
  if (limits == null) throw failure('ENODATA');
  if (typeof limits !== 'object' || Array.isArray(limits)) throw failure('EPROTO');
  const windows = {};
  for (const [key, minutes] of [['five_hour', 300], ['seven_day', 10080]]) {
    const raw = limits[key];
    if (raw == null) continue;
    const usedPercent = raw.utilization;
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)
      || usedPercent < 0 || usedPercent > 100) throw failure('EPROTO');
    const parsed = typeof raw.resets_at === 'string' ? Date.parse(raw.resets_at) : NaN;
    if (raw.resets_at != null && !Number.isFinite(parsed)) throw failure('EPROTO');
    windows[key] = { usedPercent, resetAt: Number.isFinite(parsed) ? parsed : null, durationMinutes: minutes };
  }
  if (!Object.keys(windows).length) throw failure('ENODATA');
  return { source: 'claude-code', sourceLabel: 'Claude', completeSnapshot: true,
    planType: typeof payload.subscription_type === 'string' ? payload.subscription_type : '', windows };
}

/** Bounded JSON-lines control exchange, including abort and descendants retaining stdout. */
export function probeClaudeUsage(command, { signal, timeoutMs = 8000, spawnProcess = spawn,
  home = homedir(), env = process.env } = {}) {
  if (signal?.aborted) return Promise.reject(failure('EABORT'));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command, [...CLAUDE_QUOTA_ARGS], {
        cwd: home, env: claudeQuotaEnvironment(env), stdio: ['pipe', 'pipe', 'ignore'],
        detached: process.platform !== 'win32', windowsHide: true,
      });
    } catch { reject(failure('EPROCESS')); return; }
    let settled = false, initialized = false, receivedBytes = 0, buffer = '';
    const terminate = () => {
      // Own process group only: MCP/tools are disabled, but a broken child must not orphan descendants.
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { /* Already gone. */ }
      const reap = setTimeout(() => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else if (child.exitCode == null) child.kill('SIGKILL');
        } catch { /* Already gone. */ }
      }, 500);
      reap.unref?.();
    };
    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      child.stdin.destroy(); child.stdout.destroy(); terminate();
      if (error) reject(error); else resolve(payload);
    };
    const abort = () => finish(failure('EABORT'));
    const timer = setTimeout(() => finish(failure('ETIMEDOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(failure('EPROCESS')));
    child.on('exit', () => finish(failure('EPROCESS')));
    child.stdin.on('error', () => finish(failure('EPROCESS')));
    child.stdout.on('error', () => finish(failure('EPROCESS')));
    child.stdout.on('end', () => finish(failure('EPROCESS')));
    const send = (id, subtype) => child.stdin.write(`${JSON.stringify({
      type: 'control_request', request_id: id,
      request: { subtype, ...(subtype === 'get_usage' ? { skip_behaviors: true } : {}) },
    })}\n`);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > 1024 * 1024) { finish(failure('EPROTO')); return; }
      buffer += chunk;
      let end;
      while (!settled && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message?.type !== 'control_response') continue;
        const response = message.response;
        if (!['maclawd-quota-init', 'maclawd-quota-read'].includes(response?.request_id)) continue;
        if (response.subtype !== 'success') { finish(failure('EPROTO')); return; }
        if (response.request_id === 'maclawd-quota-init' && !initialized) {
          initialized = true; send('maclawd-quota-read', 'get_usage');
        } else if (response.request_id === 'maclawd-quota-read' && initialized) {
          if (!response.response || typeof response.response !== 'object') finish(failure('EPROTO'));
          else finish(null, response.response);
        }
      }
    });
    if (signal?.aborted) abort(); else send('maclawd-quota-init', 'initialize');
  });
}

export async function readClaudeQuota({ discover = discoverClaudeBinaries, probe = probeClaudeUsage,
  timeoutMs = 25_000, candidateTimeoutMs = 8000, clock = () => performance.now(), ...options } = {}) {
  const candidates = discover(options);
  if (!candidates.length) throw failure('ENOCLI');
  const deadline = clock() + timeoutMs;
  let lastError = failure('EPROCESS');
  for (const command of candidates) {
    if (options.signal?.aborted) throw failure('EABORT');
    const remaining = deadline - clock();
    if (remaining <= 0) throw failure('ETIMEDOUT');
    try {
      return claudeQuotaReport(await probe(command, { ...options, timeoutMs: Math.min(candidateTimeoutMs, remaining) }));
    } catch (error) {
      if (options.signal?.aborted || error.code === 'EABORT') throw failure('EABORT');
      if (error.code === 'ENOTAPPLICABLE') throw error;
      lastError = failure(Object.hasOwn(ERROR_MESSAGES, error.code) ? error.code : 'EPROCESS');
    }
  }
  throw lastError;
}

export function createClaudeQuotaCollector({ read = readClaudeQuota, record = recordQuota,
  enabled = () => { const s = loadSettings(); return usageEnabled(s) && s.quotaTracking === true; },
  installed = () => discoverClaudeBinaries().length > 0,
  unavailable = () => {}, now = Date.now, cacheMs = 60_000, intervalMs = 5 * 60_000,
  maxBackoffMs = 15 * 60_000 } = {}) {
  let timer = null, running = false, flight = null, generation = 0, controller = null;
  let lastAttemptAt = null, lastSuccessAt = null, nextAttemptAt = 0, lastError = null, failures = 0;
  function refresh({ force = false } = {}) {
    if (!enabled()) return Promise.resolve({ disabled: true });
    if (flight) return flight;
    // Even forced refreshes respect error backoff; opening the panel cannot hammer a failed endpoint.
    if ((lastError || !force) && now() < nextAttemptAt) return Promise.resolve({ cached: true });
    const epoch = generation, abort = new AbortController(); controller = abort; lastAttemptAt = now();
    const task = Promise.resolve().then(() => read({ signal: abort.signal })).then((report) => {
      if (abort.signal.aborted || epoch !== generation || !enabled()) return { discarded: true };
      if (!report || !Object.keys(report.windows ?? {}).length) throw failure('ENODATA');
      record(report); lastSuccessAt = now(); lastError = null; failures = 0; nextAttemptAt = now() + cacheMs;
      return { reports: 1 };
    }).catch((error) => {
      if (abort.signal.aborted || epoch !== generation || !enabled()) return { discarded: true };
      const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : 'EPROCESS';
      lastError = { code, message: ERROR_MESSAGES[code] };
      nextAttemptAt = now() + Math.min(maxBackoffMs, cacheMs * 2 ** Math.min(failures++, 8));
      if (code === 'ENOTAPPLICABLE') unavailable();
      return { error: lastError };
    }).finally(() => { if (flight === task) { flight = null; controller = null; } });
    flight = task; return task;
  }
  return {
    refresh,
    start() {
      if (running) return;
      running = true; void refresh();
      timer = setInterval(() => { void refresh(); }, intervalMs); timer.unref?.();
    },
    stop() {
      running = false; generation++; controller?.abort(); controller = null; flight = null;
      clearInterval(timer); timer = null;
    },
    status: () => ({ installed: installed(), running, refreshing: Boolean(flight),
      lastAttemptAt, lastSuccessAt, nextAttemptAt, lastError }),
  };
}
