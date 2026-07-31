import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pickCount, toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'openclaw';
export const label = 'OpenClaw';
export const lineFilter = (line) => line.includes('"usage"') || line.includes('workspaceDir');

/**
 * OpenClaw 支持多 profile 部署：`~/.openclaw` 与 `~/.openclaw-<profile>`。
 * 与 Claude Code 的多 root 同理，只扫默认目录会让 profile 用户的数据消失。
 */
export function agentDirs() {
  const override = process.env.MACLAWD_OPENCLAW_DIR?.trim();
  if (override) return [join(override, 'agents')];

  const home = homedir();
  const dirs = [];
  try {
    for (const entry of readdirSync(home, { withFileTypes: true })) {
      if (entry.name !== '.openclaw' && !/^\.openclaw-.+/.test(entry.name)) continue;
      const agents = join(home, entry.name, 'agents');
      if (existsSync(agents)) dirs.push(agents);
    }
  } catch {
    // home 不可读时退回默认位置
  }
  if (dirs.length === 0) dirs.push(join(home, '.openclaw', 'agents'));
  return dirs;
}

export function dataDirs() {
  return agentDirs();
}

export function discover({ listJsonl }) {
  const candidates = [];
  for (const dir of agentDirs()) {
    for (const { path, size, mtimeMs, ino } of listJsonl(dir)) {
      // agents/<agentId>/sessions/*.jsonl
      if (!path.includes(`${'sessions'}/`)) continue;
      // OpenClaw 会在自己目录下嵌一个 Codex home
      // （agents/<id>/agent/codex-home/sessions/rollout-*.jsonl）。
      // 那是 Codex 的格式，不归这个解析器管——实测发现的越界。
      if (path.includes('codex-home/') || basename(path).startsWith('rollout-')) continue;
      // 轨迹文件只用来取 workspaceDir，不作为独立候选（它带的 usage 与
      // message 记录重复，收进来就是双计）。
      if (path.endsWith('.trajectory.jsonl')) continue;
      candidates.push({
        path,
        size,
        mtimeMs,
        ino,
        sessionId: basename(path, '.jsonl'),
        fallbackProject: null,
      });
    }
  }
  return candidates;
}

/**
 * 项目归属在**旁挂的轨迹文件**里，不在会话文件里：
 *   sessions/<id>.jsonl              用量（message.usage）
 *   sessions/<id>.trajectory.jsonl   workspaceDir（model.completed 上）
 * 和 Droid 读旁挂 settings.json 是同一个套路。
 */
function workspaceFromTrajectory(sessionPath) {
  const trajectory = sessionPath.replace(/\.jsonl$/, '.trajectory.jsonl');
  if (!existsSync(trajectory)) return null;
  try {
    for (const line of readFileSync(trajectory, 'utf-8').split('\n')) {
      if (!line.includes('workspaceDir')) continue;
      const obj = JSON.parse(line);
      const dir = obj?.workspaceDir ?? obj?.data?.workspaceDir;
      if (typeof dir === 'string' && dir.trim()) return dir;
    }
  } catch {
    // 轨迹文件缺失或损坏时项目留空即可，不影响用量
  }
  return null;
}

/** OpenClaw 转发多家供应商，字段命名不统一，用别名池取值。 */
export function parseObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const msg = obj.message ?? obj;
  const usage = msg.usage;
  if (!usage || typeof usage !== 'object') return null;

  const stamp = obj.timestamp ?? msg.timestamp ?? obj.time;
  const ts = typeof stamp === 'number' ? stamp : new Date(stamp).getTime();
  if (!Number.isFinite(ts)) return null;

  const input = pickCount(usage, 'input', 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens');
  const output = pickCount(usage, 'output', 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens');
  const cacheRead = pickCount(usage, 'cacheRead', 'cache_read', 'cache_read_input_tokens', 'cacheReadInputTokens');
  const cacheWrite = pickCount(usage, 'cacheWrite', 'cache_write', 'cache_creation_input_tokens', 'cacheCreationInputTokens');
  const reasoning = pickCount(usage, 'reasoning', 'reasoningTokens', 'reasoning_tokens');
  if (input + output + cacheRead + cacheWrite === 0) return null;

  return {
    source: id,
    input,
    output: toCount(output),
    cacheRead,
    write5m: cacheWrite,
    write1h: 0,
    reasoning: Math.min(reasoning, toCount(output)),
    model: String(msg.model ?? obj.model ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
    ts,
    messageId: msg.id ?? obj.id ?? null,
    requestId: null,
    uuid: obj.uuid ?? null,
    sidechain: false,
  };
}


/**
 * ⚠️ 双计陷阱（实测确认）：`type: "message"` 与 `type: "model.completed"`
 * **携带完全相同的 usage 数字**（同一次调用的 input/output/cacheRead 一模一样）。
 * 两者都收就整体翻倍——和 Kimi 的 step.end / usage.record 是同一类坑。
 *
 * 所以用量**只**取 message；model.completed 只用来取 `workspaceDir`，
 * 那是这个格式里唯一能拿到项目归属的地方（message 记录上没有 cwd）。
 */
export function createFileParser({ candidate } = {}) {
  const records = [];

  return {
    onObject(obj) {
      // model.completed 与 message 携带**完全相同**的 usage，绝不能都收。
      if (obj?.type === 'model.completed') return;
      const record = parseObject(obj);
      if (record) records.push(record);
    },
    finish() {
      const workspaceDir = candidate?.path ? workspaceFromTrajectory(candidate.path) : null;
      if (workspaceDir) {
        for (const record of records) record.cwd = workspaceDir;
      }
      return { records, state: null };
    },
  };
}
