/**
 * 规范化 usage 记录 —— 与具体工具无关。见 design/token-tracking.md「统计合同」。
 *
 * 各家工具的 API 口径互不相同，规范化在**解析器边缘**完成，下游数学统一。
 * 两条不变量，破了任何一条都会造成静默的 2× 误差：
 *
 *   不变量 1  input 不含缓存。
 *             Claude Code / Hermes / OpenCode 天然满足；
 *             WorkBuddy / Codex / Gemini / Qwen 的 input 含缓存，解析时必须减掉。
 *
 *   不变量 2  output 含 reasoning，reasoning 只是它的一个展示用子计数。
 *             这样 billable 永不重复计数，也符合计费现实（推理按输出价计费）。
 *             WorkBuddy 天然满足；把 reasoning 独立上报的工具需要加进 output。
 */

export const SYNTHETIC_MODEL = '<synthetic>';
export const UNKNOWN_MODEL = 'unknown';

/** 负数、NaN、undefined 一律归零，避免污染累加。 */
export function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 从多个候选字段名里取第一个有值的数字。各家字段命名不统一。 */
export function pickCount(source, ...keys) {
  if (!source || typeof source !== 'object') return 0;
  for (const key of keys) {
    if (source[key] === undefined || source[key] === null) continue;
    const n = Number(source[key]);
    if (Number.isFinite(n)) return n > 0 ? n : 0;
  }
  return 0;
}

/**
 * 把缓存写拆成 5m / 1h 两档（Anthropic 口径）。
 *
 * 当前 Claude 日志同时携带总量与 TTL 拆分。取 max() 避免把两者重复计数，同时容忍
 * 只填了一半的日志；总量大于拆分之和时，差额记进 5m 档（默认 TTL）。
 * 拆开存是因为两档单价不同（1h 是 2× 输入价），且让成本能在读取时按当前价格表推导。
 */
export function cacheWriteSplit(usage) {
  const total = toCount(usage?.cache_creation_input_tokens);
  const breakdown = usage?.cache_creation || {};
  const has5m = breakdown.ephemeral_5m_input_tokens !== undefined;
  const has1h = breakdown.ephemeral_1h_input_tokens !== undefined;

  if (!has5m && !has1h) return { write5m: total, write1h: 0 };

  const w5 = toCount(breakdown.ephemeral_5m_input_tokens);
  const w1 = toCount(breakdown.ephemeral_1h_input_tokens);
  const split = w5 + w1;
  if (total > split) return { write5m: w5 + (total - split), write1h: w1 };
  return { write5m: w5, write1h: w1 };
}

/**
 * 不变量 1 的执行器：当 total == input + output 时，说明 input 已含缓存，减掉。
 *
 * 用 total 做运行时判定而不是按工具硬编码——WorkBuddy 这类壳会转发多家供应商，
 * 同一个工具的不同 provider 口径可能不同（tokei 也是这个思路）。
 */
export function resolveInclusiveInput({ input, output, cacheRead, cacheWrite, total }) {
  const inputTotal = toCount(input);
  const out = toCount(output);
  let read = toCount(cacheRead);
  let write = toCount(cacheWrite);

  const inclusive = Number.isFinite(Number(total)) && Number(total) === inputTotal + out;
  if (!inclusive) return { input: inputTotal, cacheRead: read, cacheWrite: write };

  // 缓存部分不能超过 input 本身，否则日志自相矛盾，按 input 截断。
  read = Math.min(read, inputTotal);
  write = Math.min(write, Math.max(inputTotal - read, 0));
  return {
    input: Math.max(inputTotal - read - write, 0),
    cacheRead: read,
    cacheWrite: write,
  };
}

// ---------- 派生量 ----------

export function cacheWrite(record) {
  return toCount(record.write5m) + toCount(record.write1h);
}

/** 近似计费量：不含缓存读。面板主数字用这个口径。 */
export function billable(record) {
  return toCount(record.input) + cacheWrite(record) + toCount(record.output);
}

/** 上下文吞吐量：四项全加。长会话里缓存读常占 80% 以上。 */
export function throughput(record) {
  return billable(record) + toCount(record.cacheRead);
}

/** 缓存命中率。分母是全部输入 token（读 + 写 + 非缓存输入）。 */
export function hitRate(record) {
  const read = toCount(record.cacheRead);
  const denominator = read + cacheWrite(record) + toCount(record.input);
  return denominator === 0 ? 0 : read / denominator;
}

// ---------- 累加桶 ----------

export const BUCKET_FIELDS = [
  'input', 'output', 'cacheRead', 'write5m', 'write1h', 'reasoning',
];

export function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0 };
}

export function addInto(bucket, record) {
  for (const field of BUCKET_FIELDS) bucket[field] += toCount(record[field]);
  return bucket;
}

export function mergeBucket(target, source) {
  for (const field of BUCKET_FIELDS) target[field] += toCount(source[field]);
  return target;
}
