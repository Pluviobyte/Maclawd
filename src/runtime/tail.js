import { parsers as allParsers } from './parsers/index.js';
import { listJsonl } from './scan.js';
import { readJson, writeJson } from './store.js';
import { TAIL_STATE_FILE } from './paths.js';
import { lastNewlineBoundary, readLines, tailFingerprint } from './read-lines.js';
import { throughput } from './usage-record.js';
import { usageEnabled } from './settings.js';

/**
 * 实时速率通道。见 design/token-experience.md 第 2 层（强度驱动）。
 *
 * 与全量扫描是两条独立轨道，职责不同：
 *   扫描  回答「今天一共多少」——要完整、要准确、可以慢
 *   尾读  回答「现在烧得多快」——要新鲜、要便宜、不关心历史
 *
 * 所以首次见到某个文件时 offset 直接设成当前 size：**只统计新增，不回溯历史**。
 * 历史归扫描器负责，尾读回溯只会把启动瞬间的速率算成天文数字。
 */

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export function createTailer({
  parsers = allParsers,
  windowMs = DEFAULT_WINDOW_MS,
  persist = true,
} = {}) {
  const loaded = persist ? readJson(TAIL_STATE_FILE, null) : null;
  const files = new Map(Object.entries(loaded?.files ?? {}));
  // 环形样本：[时刻, throughput]。窗口外的样本每次 poll 时丢弃。
  let samples = [];
  // 每个解析器分别建立首轮 discover 基线；某个来源首次探测失败不能被别的来源
  // “代替初始化”，否则它恢复时会把已有整份文件误当成运行中新建。
  const initializedParsers = new WeakSet();

  const save = () => {
    if (!persist) return;
    try {
      writeJson(TAIL_STATE_FILE, { files: Object.fromEntries(files) });
    } catch {
      // 游标是派生数据，写失败不影响本次读取结果。
    }
  };

  async function poll({ now = Date.now(), ignoreSettings = false } = {}) {
    const fresh = [];

    // 与扫描同一条闸门：关掉之后不碰任何文件，也不推进游标。
    if (!ignoreSettings && !usageEnabled()) {
      samples = [];
      return {
        fresh, tokensPerMin: 0, tokensPerMinBySource: {},
        windowTokens: 0, trackedFiles: 0, disabled: true,
      };
    }

    for (const parser of parsers) {
      let candidates;
      try {
        candidates = parser.discover({ listJsonl });
      } catch {
        continue;
      }

      for (const candidate of candidates) {
        if (typeof parser.tailCandidate === 'function' && !parser.tailCandidate(candidate)) {
          continue;
        }
        let prev = files.get(candidate.path);

        // 首轮启动只建立基线，不回放历史。运行期间新出现的、由解析器明确声明
        // 可安全从头读取的文件（例如 Cursor 当天第一条事件创建的 JSONL）则从 0 跟读。
        if (!prev) {
          const fromStart = initializedParsers.has(parser)
            && parser.tailNewCandidateFromStart?.(candidate) === true;
          prev = { ino: candidate.ino, offset: fromStart ? 0 : candidate.size };
          files.set(candidate.path, prev);
          if (!fromStart || candidate.size === 0) continue;
        }

        // inode 变了或文件缩小 → 轮转/截断，从头开始重新跟。
        if (prev.ino !== candidate.ino || candidate.size < prev.offset) {
          files.set(candidate.path, { ino: candidate.ino, offset: candidate.size });
          continue;
        }

        if (candidate.size === prev.offset) continue;

        const boundary = await lastNewlineBoundary(candidate.path, candidate.size);
        if (boundary <= prev.offset) continue;

        // 尾部指纹不吻合说明文件被重写过，不能沿用 offset。
        const fingerprint = await tailFingerprint(candidate.path, prev.offset);
        if (prev.tail && fingerprint !== prev.tail) {
          files.set(candidate.path, { ino: candidate.ino, offset: boundary, tail: await tailFingerprint(candidate.path, boundary) });
          continue;
        }

        const fileParser = parser.createFileParser({ state: null, candidate, mode: 'tail' });
        const filter = parser.lineFilter;
        const accept = typeof filter === 'function'
          ? filter
          : (typeof filter === 'string' && filter ? (line) => line.includes(filter) : null);

        try {
          await readLines(candidate.path, prev.offset, boundary, (line) => {
            if (accept && !accept(line)) return;
            let obj;
            try {
              obj = JSON.parse(line);
            } catch {
              return;
            }
            try {
              fileParser.onObject(obj);
            } catch {
              // 单行失败不影响其余
            }
          });
          const { records } = fileParser.finish();
          for (const record of records) fresh.push(record);
        } catch {
          // 读失败就等下一轮，不推进 offset
          continue;
        }

        files.set(candidate.path, {
          ino: candidate.ino,
          offset: boundary,
          tail: await tailFingerprint(candidate.path, boundary),
        });
      }
      initializedParsers.add(parser);
    }

    const existingKeys = new Set(samples.map(([, , record]) => {
      if (!record?.messageId) return null;
      return [record.source, record.messageId, record.requestId ?? '', record.uuid ?? ''].join('|');
    }).filter(Boolean));
    const uniqueFresh = [];
    for (const record of fresh) {
      const key = record?.messageId
        ? [record.source, record.messageId, record.requestId ?? '', record.uuid ?? ''].join('|')
        : null;
      if (key && existingKeys.has(key)) continue;
      if (key) existingKeys.add(key);
      uniqueFresh.push(record);
      // 记录时间戳可能略微超前于本机时钟，钳到 now，避免样本落在窗口之外。
      samples.push([Math.min(record.ts, now), throughput(record), record]);
    }
    const cutoff = now - windowMs;
    samples = samples.filter(([ts]) => ts >= cutoff);
    save();

    const windowTokens = samples.reduce((sum, [, tokens]) => sum + tokens, 0);
    const minutes = windowMs / 60_000;
    const tokensBySource = {};
    for (const [, tokens, record] of samples) {
      if (typeof record?.source !== 'string' || !record.source) continue;
      tokensBySource[record.source] = (tokensBySource[record.source] ?? 0) + tokens;
    }

    return {
      fresh: uniqueFresh,
      tokensPerMin: Math.round(windowTokens / minutes),
      tokensPerMinBySource: Object.fromEntries(Object.entries(tokensBySource)
        .map(([source, tokens]) => [source, Math.round(tokens / minutes)])),
      windowTokens,
      trackedFiles: files.size,
    };
  }

  return {
    poll,
    /** 供测试与诊断：当前窗口内的样本。 */
    samples: () => samples.map(([ts, tokens, record]) => ({ ts, tokens, source: record.source })),
  };
}

/**
 * 把速率映射成动画强度 [0, 1]。
 *
 * 用饱和曲线而非线性：token 速率的分布是重尾的，线性映射会让绝大多数时间都挤在
 * 最低档。参考 tokcat 的 RunCat 模型，但 Maclawd 只输出强度标量——是否用它缩放
 * 播放速率是设计决策，见 design/token-experience.md 待决事项。
 */
export function intensityFromRate(tokensPerMin, { saturationRate = 60_000 } = {}) {
  if (!Number.isFinite(tokensPerMin) || tokensPerMin <= 0) return 0;
  return 1 - Math.exp(-tokensPerMin / saturationRate);
}
