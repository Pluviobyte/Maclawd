import { basename, join, sep } from 'node:path';
import { getClaudeRoots, getProjectDirs } from '../claude-roots.js';
import { cacheWriteSplit, toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { createTurnTracker } from '../sessions.js';

export const id = 'claude-code';
export const label = 'Claude Code';

/**
 * Claude Code 不做行过滤（lineFilter = null）。
 *
 * 用量只在 assistant 行，本可以用 `"usage"` 子串廉价筛掉绝大多数行；但会话时长
 * 需要 user / assistant / tool_use / tool_result 全部行的时间戳，而那些行没有 usage。
 * 二者只能取其一，这里选择多花一点 CPU 换到 activeSeconds——「今天真正工作了多久」
 * 和桌宠的 energy 都依赖它，见 design/token-experience.md。
 *
 * 其余解析器仍然使用子串过滤，因为它们暂不产出会话指标。
 */
export const lineFilter = null;

export function dataDirs() {
  return getProjectDirs();
}

export function roots() {
  return getClaudeRoots();
}

/** 从 ~/.claude/projects/-Users-rain-Desktop-Maclawd 这种编码目录名反推项目。 */
function projectFromEncodedDir(relative) {
  if (!relative) return null;
  const firstSegment = relative.split(sep)[0];
  if (!firstSegment) return null;
  const parts = firstSegment.split('-').filter(Boolean);
  return parts.at(-1) || null;
}

/** 同时兼容 Unix 与 Windows 的 cwd 值，与当前平台无关。 */
export function projectFromCwd(cwd) {
  if (typeof cwd !== 'string') return null;
  const trimmed = cwd.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) || null;
}

/**
 * 列出候选文件。同一 session id 可能出现在多个 root（~/.claude 与
 * CLAUDE_CONFIG_DIR 之间复制），由 scan.js 统一按完整度选一份，不求和。
 */
export function discover({ listJsonl }) {
  const candidates = [];
  for (const root of getClaudeRoots()) {
    const baseDir = join(root, 'projects');
    for (const { path, size, mtimeMs, ino, relative } of listJsonl(baseDir)) {
      candidates.push({
        path,
        size,
        mtimeMs,
        ino,
        sessionId: basename(path, '.jsonl'),
        fallbackProject: projectFromEncodedDir(relative),
      });
    }
  }
  return candidates;
}

/**
 * Claude Code 的三类输入 token 互斥，不存在包含关系，所以不需要 inclusive 判定。
 *
 * <synthetic> 单独成类，**不向前结转**。结转（vibe-usage 的 lastModel）会在模型
 * 切换边界把 token 记到错误的模型头上。
 */
export function parseObject(obj) {
  if (!obj || obj.type !== 'assistant') return null;
  const message = obj.message;
  const usage = message?.usage;
  if (!usage) return null;
  if (typeof obj.timestamp !== 'string') return null;

  const timestamp = new Date(obj.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  const { write5m, write1h } = cacheWriteSplit(usage);
  const rawModel = typeof message.model === 'string' ? message.model.trim() : '';

  return {
    source: id,
    input: toCount(usage.input_tokens),
    output: toCount(usage.output_tokens),
    cacheRead: toCount(usage.cache_read_input_tokens),
    write5m,
    write1h,
    // Claude Code 日志不单独上报推理 token；它已包含在 output_tokens 里（不变量 2）。
    reasoning: 0,
    model: rawModel || UNKNOWN_MODEL,
    cwd: typeof obj.cwd === 'string' && obj.cwd.trim() ? obj.cwd : null,
    // epoch 毫秒而非 Date：解析缓存要序列化，数字最省且无时区歧义。
    ts: timestamp.getTime(),
    messageId: typeof message.id === 'string' && message.id ? message.id : null,
    requestId: obj.requestId || obj.request_id || null,
    uuid: typeof obj.uuid === 'string' && obj.uuid ? obj.uuid : null,
    sidechain: obj.isSidechain === true,
  };
}

/** 时间事件：user 记为 user，其余交互一律算 assistant 侧。 */
export function timingRole(obj) {
  if (!obj || typeof obj.timestamp !== 'string') return null;
  switch (obj.type) {
    case 'user': return 'user';
    case 'assistant':
    case 'tool_use':
    case 'tool_result': return 'assistant';
    default: return null;
  }
}

/**
 * 用量记录彼此独立，但会话时长需要跨行的轮次状态，所以不能用 statelessParser。
 * 轮次状态随解析缓存持久化，增量尾读时从上次接着算。
 */
export function createFileParser({ state } = {}) {
  const records = [];
  const tracker = createTurnTracker(state?.turn ?? null);

  return {
    onObject(obj) {
      const record = parseObject(obj);
      if (record) records.push(record);

      const role = timingRole(obj);
      if (role) {
        const ts = new Date(obj.timestamp).getTime();
        if (!Number.isNaN(ts)) tracker.onEvent(role, ts);
      }
    },
    finish() {
      return {
        records,
        session: tracker.snapshot(),
        state: { turn: tracker.state() },
      };
    },
  };
}
