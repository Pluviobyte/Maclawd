import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { createTurnTracker } from '../sessions.js';

export const id = 'codex';
export const label = 'Codex';

/**
 * Codex 需要三类行：token_count 取用量，session_meta 取项目与 fork 关系，
 * turn_context 取模型名。单个子串过滤不够，所以用谓词。
 *
 * 注意不能只按 `"token_count"` 过滤——实测工具输出正文里出现过
 * `original_token_count`，在 290MB 的 rollout 上这种误命中的 JSON.parse 开销可观。
 */
export const lineFilter = (line) => (
  line.includes('"total_token_usage"')
  || line.includes('"session_meta"')
  || line.includes('"turn_context"')
  || line.includes('"task_started"')
  || line.includes('"turn_started"')
);

/** CODEX_HOME 与 Codex CLI 自身一致；MACLAWD_CODEX_HOME 供测试覆盖。 */
export function codexHome() {
  const override = process.env.MACLAWD_CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim();
  return override || join(homedir(), '.codex');
}

/**
 * Codex 会把「已完成」的会话从 sessions/ 移到 archived_sessions/。
 * 必须两个目录一起扫——只扫 live 目录会永久丢掉两次扫描之间被归档的会话。
 */
export function sessionDirs() {
  const home = codexHome();
  return [join(home, 'sessions'), join(home, 'archived_sessions')];
}

export function dataDirs() {
  return sessionDirs();
}

/** rollout-2026-07-19T00-03-27-<uuid>.jsonl → <uuid> */
function sessionIdFromName(path) {
  const name = basename(path, '.jsonl');
  const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : name;
}

export function discover({ listJsonl }) {
  const candidates = [];
  for (const dir of sessionDirs()) {
    for (const { path, size, mtimeMs, ino } of listJsonl(dir)) {
      candidates.push({
        path,
        size,
        mtimeMs,
        ino,
        // 同一 session id 同时存在于 live 与 archive 时，由 scan.js 选更完整的一份，
        // 不求和——瞬时重叠否则会让 buckets 翻倍。
        sessionId: sessionIdFromName(path),
        fallbackProject: null,
      });
    }
  }
  return candidates;
}

const USAGE_FIELDS = [
  'input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens',
];

/**
 * 快照键：total_token_usage 与 last_token_usage 全部字段的指纹。
 *
 * fork 与 subagent 的 rollout 会在开头**逐条复制**父会话的 token_count，复制件的
 * 这两个快照与父会话原件完全相同。用它作为去重键，跨文件的重放前缀就会自然折叠成
 * 一条，不需要去读父文件、也不需要维护重放索引（tokei 用的就是这个思路）。
 *
 * 12 个数字的组合熵足够高，不同会话偶然撞上的概率可以忽略；唯一的退化情形是
 * 全零快照，调用方对此单独兜底。
 */
function snapshotKey(total, last) {
  const parts = [];
  for (const source of [total, last]) {
    for (const field of USAGE_FIELDS) parts.push(source?.[field] ?? '');
  }
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

/**
 * Payload 指纹：token_count 整个 payload 的 SHA256 前缀。
 *
 * 这是 snapshotKey 的兜底。snapshotKey 依赖 total_token_usage 的累计值，
 * 而 fork 子进程在某些版本中会从零开始计累计——此时同一条被复制的 API 响应，
 * 在父子文件里的 snapshotKey 不同，snapshotKey 去重失效。
 *
 * payload 指纹直接对 token_count 的原始 payload 取摘要，不含外层 timestamp
 * （Codex 复制时会给外层打新时间戳，但 payload 原样保留），所以在父子文件
 * 之间一定相同。用它做第二把键，vibe-usage 也是这个思路。
 */
function payloadFingerprint(payload) {
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url')
    .slice(0, 16);
}

function projectFromCwd(cwd) {
  if (typeof cwd !== 'string') return null;
  const trimmed = cwd.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) || null;
}

function isSubagentMeta(meta) {
  if (meta?.thread_source === 'subagent' || meta?.source === 'subagent') return true;
  if (meta?.source && typeof meta.source === 'object' && 'subagent' in meta.source) return true;
  return meta?.parent_thread_id != null;
}

function timestampMs(value) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function epochMs(value) {
  if (typeof value === 'string' && value.trim()) value = Number(value);
  if (!Number.isFinite(value)) return null;
  return value < 1e12 ? value * 1000 : value;
}

function isTaskStarted(payload) {
  return payload?.type === 'task_started' || payload?.type === 'turn_started';
}

const OWN_TASK_START_WINDOW_MS = 5_000;

/**
 * 用量计算完全采用 vibe-usage 的方案：
 *
 *   1. 累计总量未前进且为正 → 判为重复发射或零用量记账事件（如 compaction），计零。
 *      真实的 API 调用必然让累计计数器前进。限定为正值，是为了让那些把
 *      total_token_usage 全部留空的构建不至于把真实用量也压掉。
 *   2. 优先用 last_token_usage（每次请求的增量）；缺失时用累计总量做差。
 *   3. 差值出现负数说明计数器在 compaction 或新窗口后被重置，此时把当前累计值
 *      当作新基线，而不是让负数抵消掉已经记录的合法用量。
 *   4. 无论是否重放/重复，都要推进累计基线——total_token_usage 是会话级而非模型级，
 *      少推进一次会在模型切换后把整个累计总量再算一遍。
 *
 * 口径归一（OpenAI → 本项目不变量）：
 *   input_tokens 含缓存  → 减掉 cached_input_tokens（不变量 1）
 *   output_tokens 含推理 → 原样保留，reasoning 作为子计数（不变量 2）
 */
export function createFileParser({ state, candidate } = {}) {
  const records = [];
  let prevCumulativeTotal = state?.prevCumulativeTotal ?? null;
  let prevTotal = state?.prevTotal ?? null;
  let turnContextModel = state?.turnContextModel ?? null;
  let sessionCwd = state?.sessionCwd ?? null;
  let canonicalSessionId = state?.canonicalSessionId ?? null;
  let ordinal = state?.ordinal ?? 0;
  let isSubagent = state?.isSubagent ?? false;
  let sessionStartedAtMs = state?.sessionStartedAtMs ?? null;
  let sessionMetaCount = state?.sessionMetaCount ?? 0;
  let ownTaskBoundaryReached = state?.ownTaskBoundaryReached ?? false;
  let foreignSessionMetaSeen = state?.foreignSessionMetaSeen ?? false;
  let ownSessionBoundaryReached = state?.ownSessionBoundaryReached ?? false;
  let resetRecords = false;
  let resetSession = false;
  let tracker = createTurnTracker(state?.turn ?? null);

  return {
    onRawLine(line) {
      // Codex rollout 可达数百 MB，不能为了会话时长 JSON.parse 每一条工具输出。
      // 外层 timestamp/type 总在行首附近，只看前 512 字节即可把等待与生成区间
      // 还原出来；usage 主解析仍走严格 JSON。
      const head = line.slice(0, 512);
      const match = head.match(
        /"timestamp"\s*:\s*"([^"]+)"[\s\S]*?"type"\s*:\s*"([^"]+)"/,
      );
      if (!match) return;
      const ts = timestampMs(match[1]);
      if (ts == null) return;
      const role = match[2] === 'session_meta' || match[2] === 'turn_context'
        ? 'user'
        : 'assistant';
      tracker.onEvent(role, ts);
    },

    onObject(obj) {
      const payload = obj?.payload;
      if (!payload) return;

      if (obj.type === 'session_meta') {
        sessionMetaCount++;
        // 只有第一个 session_meta 是本文件的正身；后续的都是被复制进来的父会话历史。
        if (!canonicalSessionId) {
          canonicalSessionId = payload.id || payload.session_id || null;
          if (!sessionCwd && payload.cwd) sessionCwd = payload.cwd;
          isSubagent = isSubagentMeta(payload);
          sessionStartedAtMs = timestampMs(payload.timestamp) ?? timestampMs(obj.timestamp);
        } else if (payload.id && payload.id !== canonicalSessionId) {
          // Full-history forks start with their own meta, replay one or more
          // parent session ids, then emit their own meta again at the exact
          // point where new work begins. Token snapshots are already deduped
          // across files; reset the timing tracker here so message totals do
          // not include the copied parent transcript as well.
          foreignSessionMetaSeen = true;
        } else if (
          payload.id === canonicalSessionId
          && foreignSessionMetaSeen
          && !ownSessionBoundaryReached
        ) {
          tracker = createTurnTracker();
          tracker.onEvent('user', timestampMs(obj.timestamp) ?? sessionStartedAtMs);
          ownSessionBoundaryReached = true;
          resetSession = true;
        }
        return;
      }

      if (obj.type === 'turn_context') {
        if (payload.model) turnContextModel = payload.model;
        if (!sessionCwd && payload.cwd) sessionCwd = payload.cwd;
        return;
      }

      if (obj.type === 'event_msg' && isTaskStarted(payload)) {
        if (isSubagent && !ownTaskBoundaryReached) {
          const startedAt = epochMs(payload.started_at);
          const nearCanonicalStart = startedAt != null && sessionStartedAtMs != null
            && Math.abs(startedAt - sessionStartedAtMs) <= OWN_TASK_START_WINDOW_MS;
          // 现代 rollout 用 started_at 精确标出 child 自己的 task；旧单-meta
          // subagent 不复制父 task_started，因此它的第一条 task 也是安全边界。
          if (nearCanonicalStart || sessionMetaCount === 1) {
            records.length = 0;
            ownTaskBoundaryReached = true;
            resetRecords = true;
            tracker = createTurnTracker();
            tracker.onEvent('user', sessionStartedAtMs ?? startedAt ?? timestampMs(obj.timestamp));
            resetSession = true;
          }
        }
        return;
      }

      if (payload.type !== 'token_count') return;
      const info = payload.info;
      if (!info) return;

      ordinal++;

      const cumulativeTotal = info.total_token_usage?.total_tokens;
      const isDuplicateEmission = typeof cumulativeTotal === 'number'
        && cumulativeTotal > 0
        && cumulativeTotal === prevCumulativeTotal;
      if (typeof cumulativeTotal === 'number') prevCumulativeTotal = cumulativeTotal;

      const curr = info.total_token_usage;
      let usage = info.last_token_usage;
      if (!usage && curr) {
        if (prevTotal) {
          const delta = {
            input_tokens: (curr.input_tokens || 0) - (prevTotal.input_tokens || 0),
            output_tokens: (curr.output_tokens || 0) - (prevTotal.output_tokens || 0),
            cached_input_tokens: (curr.cached_input_tokens || 0) - (prevTotal.cached_input_tokens || 0),
            cache_write_input_tokens: (curr.cache_write_input_tokens || 0) - (prevTotal.cache_write_input_tokens || 0),
            reasoning_output_tokens: (curr.reasoning_output_tokens || 0) - (prevTotal.reasoning_output_tokens || 0),
          };
          usage = Object.values(delta).some((value) => value < 0) ? curr : delta;
        } else {
          usage = curr;
        }
      }
      // 基线必须无条件推进，重复与重放也一样。
      if (curr) prevTotal = { ...curr };
      if (!usage) return;
      if (isDuplicateEmission) return;

      const timestamp = obj.timestamp ? new Date(obj.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) return;

      const cachedInput = toCount(usage.cached_input_tokens ?? usage.cache_read_input_tokens);
      const inputTotal = toCount(usage.input_tokens);
      const output = toCount(usage.output_tokens);
      const reasoning = toCount(usage.reasoning_output_tokens);
      const cacheWrite = toCount(usage.cache_write_input_tokens);

      // 不变量 1：OpenAI 的 input_tokens 含缓存，减掉后三项互斥。
      const nonCachedInput = Math.max(inputTotal - cachedInput - cacheWrite, 0);
      if (nonCachedInput + output + cachedInput + cacheWrite === 0) return;

      // payload 指纹：对 token_count 的原始 payload 取摘要。Codex 复制父记录
      // 时会重写外层 timestamp 但保留 payload 原样，所以父子文件里同一条被复制的
      // API 响应，其指纹一定相同。这比依赖 total_token_usage 累计值的 snapshotKey
      // 更鲁棒——fork 子进程在某些版本中会从零开始计累计，导致 snapshotKey 失效。
      // vibe-usage 也用 SHA256(JSON.stringify(payload)) 做去重指纹。
      //
      // 全零快照（所有 usage 字段都是 0 或缺失）退回文件内唯一键，
      // 避免不同文件中无意义的全零记录被跨文件误合并。
      const hasPayload = typeof cumulativeTotal === 'number' && cumulativeTotal > 0;
      const dedupeKey = hasPayload
        ? payloadFingerprint(payload)
        : `${candidate?.path ?? ''}#${ordinal}`;

      records.push({
        source: id,
        input: nonCachedInput,
        output,
        cacheRead: cachedInput,
        write5m: cacheWrite,
        write1h: 0,
        reasoning: Math.min(reasoning, output),
        model: info.model || payload.model || turnContextModel || UNKNOWN_MODEL,
        cwd: sessionCwd,
        ts: timestamp.getTime(),
        messageId: dedupeKey,
        requestId: null,
        uuid: null,
        sidechain: false,
      });
    },

    finish() {
      const project = projectFromCwd(sessionCwd);
      if (project) {
        for (const record of records) record.cwd = sessionCwd;
      }
      return {
        // 活跃 subagent 可能正处于复制父历史的中间态。边界出现前不发布临时
        // 峰值；出现后要求扫描器丢弃此前缓存的 replay 记录。
        records: isSubagent && !ownTaskBoundaryReached ? [] : records,
        resetRecords: resetRecords || (isSubagent && !ownTaskBoundaryReached),
        session: isSubagent && !ownTaskBoundaryReached ? null : tracker.snapshot(),
        resetSession: resetSession || (isSubagent && !ownTaskBoundaryReached),
        // 续读状态：增量尾读时解析器要从这里接着算累计基线。
        state: {
          prevCumulativeTotal,
          prevTotal,
          turnContextModel,
          sessionCwd,
          canonicalSessionId,
          ordinal,
          isSubagent,
          sessionStartedAtMs,
          sessionMetaCount,
          ownTaskBoundaryReached,
          foreignSessionMetaSeen,
          ownSessionBoundaryReached,
          turn: tracker.state(),
        },
      };
    },
  };
}
