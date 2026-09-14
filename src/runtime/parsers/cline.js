import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { hostRoots, taskToRecord } from './vscode-forks.js';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { createTurnTracker } from '../sessions.js';

export const id = 'cline';
export const label = 'Cline';
export const readMode = 'whole';
export const lineFilter = null;
const extensionId = 'saoudrizwan.claude-dev';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

function unique(paths) {
  return [...new Set(paths.filter(Boolean).map(path => {
    try { return realpathSync(path); } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return path;
      throw err;
    }
  }))];
}

function stores() {
  const override = process.env.MACLAWD_CLINE_DIRS?.trim();
  const home = process.env.CLINE_DIR?.trim() || join(homedir(), '.cline');
  const roots = override ? override.split(delimiter).map(p => p.trim()).filter(Boolean)
    : [join(homedir(), '.cline'), home, process.env.CLINE_DATA_DIR?.trim() || join(home, 'data'),
      ...hostRoots().map(root => join(root, 'User/globalStorage', extensionId))];
  const legacy = unique(roots.flatMap(root => [root, join(root, 'data')]));
  const sdk = unique([...legacy.map(root => join(root, 'sessions')),
    ...(!override && process.env.CLINE_SESSION_DATA_DIR?.trim() ? [process.env.CLINE_SESSION_DATA_DIR.trim()] : [])]);
  return { legacy, sdk };
}

export function dataDirs() { const { legacy, sdk } = stores(); return unique([...legacy, ...sdk]); }

function taskItems(root) {
  return Array.isArray(root) ? root : root?.taskHistory ?? root?.tasks ?? (root && typeof root === 'object' ? [root] : []);
}
function taskMetadata(item) {
  return { id: String(item.id ?? ''), identity: String(item.ulid || item.id || ''),
    model: item.modelId || item.apiModelId || item.model || UNKNOWN_MODEL,
    cwd: item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree || item.cwd || item.workspace || null };
}

export function discover({ listJsonl }) {
  const { legacy, sdk } = stores();
  const candidates = new Map();
  for (const root of legacy) {
    const files = listJsonl(root, { extensions: ['.json'] });
    const byPath = new Map(files.map(file => [file.path, file]));
    for (const file of files) {
      const relative = file.path.slice(root.length + 1);
      if (!['taskHistory.json', 'state/taskHistory.json', 'history_item.json'].includes(relative)
        && !/^tasks\/[^/]+\/history_item\.json$/.test(relative)) continue;
      const items = taskItems(JSON.parse(readFileSync(file.path, 'utf8')));
      if (!Array.isArray(items)) throw new Error('Cline 任务索引格式不支持');
      const fallbacks = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const metadata = taskMetadata(item);
        const safeId = metadata.id && !/[\\/]/.test(metadata.id) && !['.', '..'].includes(metadata.id);
        const messages = safeId ? byPath.get(join(root, 'tasks', metadata.id, 'ui_messages.json')) : null;
        if (messages) candidates.set(messages.path, { ...messages, kind: 'legacy-messages', metadata,
          sessionId: messages.path, cacheKey: hash(metadata) });
        else fallbacks.push(item);
      }
      if (fallbacks.length) candidates.set(file.path, { ...file, kind: 'legacy-index',
        sessionId: file.path, cacheKey: hash(fallbacks.map(taskMetadata)), fallbackIds: fallbacks.map(item => String(item.id ?? '')) });
    }
  }
  for (const root of sdk) {
    for (const file of listJsonl(root, { extensions: ['.json'] })) {
      if (!file.path.endsWith('.messages.json')) continue;
      const sessionId = basename(dirname(file.path));
      const manifest = JSON.parse(readFileSync(join(dirname(file.path), `${sessionId}.json`), 'utf8'));
      if (manifest?.version !== 1 || manifest.session_id !== sessionId) throw new Error('Cline SDK 会话 manifest 不一致或版本不支持');
      const metadata = { sessionId, model: manifest.model || UNKNOWN_MODEL,
        cwd: manifest.workspace_root || manifest.cwd || null, startedAt: manifest.started_at || null };
      candidates.set(file.path, { ...file, kind: 'sdk', metadata, sessionId: file.path, cacheKey: hash(metadata) });
    }
  }
  return [...candidates.values()];
}

// Official contract: cline/cline 19ddebb3, messages-contract-v1.md and
// services/usage.ts. SDK inputTokens INCLUDES cache reads AND cache writes;
// legacy tokensIn excludes both. Never share their normalization formula.
export function createFileParser({ candidate = {} } = {}) {
  let root;
  return {
    onObject(value) { root = value; },
    finish() {
      if (root == null) throw new Error('Cline 用量文件未完成写入或 JSON 损坏');
      const records = [], tracker = createTurnTracker();
      const metadata = candidate.metadata ?? {};
      if (candidate.kind === 'sdk') {
        if (root.version !== 1 || !Array.isArray(root.messages) || typeof root.sessionId !== 'string'
          || (root.sessionId !== metadata.sessionId && root.origin?.parentThreadId !== metadata.sessionId)) {
          throw new Error('Cline SDK messages artifact 不一致或版本不支持');
        }
        for (const [index, message] of root.messages.entries()) {
          if (!message || typeof message.ts !== 'number' || !Number.isFinite(new Date(message.ts).getTime())) continue;
          if (message.role === 'user') {
            const isPrompt = root.agent === 'lead' && !message.metadata?.kind && message.metadata?.userRunSpan !== 0
              && !['system', 'status', 'error', 'tool'].includes(message.metadata?.displayRole)
              && !message.content?.some?.(block => ['tool_result', 'tool-result'].includes(block?.type));
            if (isPrompt) tracker.onEvent('user', message.ts);
            continue;
          }
          if (message.role !== 'assistant') continue;
          tracker.onEvent('assistant', message.ts);
          const metric = message.metrics;
          if (!metric) continue;
          const input = toCount(metric.inputTokens), output = toCount(metric.outputTokens);
          const cacheRead = Math.min(input, toCount(metric.cacheReadTokens));
          const cacheWrite = Math.min(input - cacheRead, toCount(metric.cacheWriteTokens));
          if (input + output === 0) continue;
          records.push({ source: id, ts: message.ts, cwd: metadata.cwd,
            model: message.modelInfo?.id || metadata.model || UNKNOWN_MODEL,
            input: input - cacheRead - cacheWrite, cacheRead, write5m: cacheWrite, write1h: 0,
            output, reasoning: 0,
            messageId: JSON.stringify(['sdk', message.id || `${root.sessionId}:${index}`, message.role, message.ts]),
            requestId: null, uuid: null, sidechain: false });
        }
      } else if (candidate.kind === 'legacy-messages') {
        if (!Array.isArray(root)) throw new Error('Cline 旧版消息格式不支持');
        for (const message of root) {
          if (!message || typeof message.ts !== 'number' || !Number.isFinite(new Date(message.ts).getTime())) continue;
          if (message.type === 'ask' || (message.type === 'say' && message.say === 'user_feedback')) {
            tracker.onEvent('user', message.ts);
          }
          if (message.type !== 'say' || message.say !== 'api_req_started') continue;
          let info;
          try { info = JSON.parse(message.text); } catch { continue; }
          const record = taskToRecord({ ...info, id: `legacy:${metadata.identity}:${message.ts}`, ts: message.ts, cwd: metadata.cwd },
            { source: id, fallbackModel: metadata.model });
          if (record) { records.push(record); tracker.onEvent('assistant', message.ts); }
        }
      } else {
        // If an old installation only retains a task summary, preserve it.
        // Never add that cumulative summary on top of its per-call ledger.
        for (const item of taskItems(root)) {
          if (candidate.fallbackIds && !candidate.fallbackIds.includes(String(item?.id ?? ''))) continue;
          const details = taskMetadata(item ?? {});
          const record = taskToRecord({ ...item, cwd: details.cwd }, { source: id, fallbackModel: details.model });
          if (record) records.push(record);
        }
      }
      return { records, state: null, session: tracker.snapshot() };
    },
  };
}
