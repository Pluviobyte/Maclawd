import { readdirSync, statSync } from 'node:fs';
import { join, relative as relativePath } from 'node:path';
import { dedupe } from './dedupe.js';
import { parsers as allParsers } from './parsers/index.js';
import { readJson, writeJson } from './store.js';
import { SCAN_CACHE_FILE } from './paths.js';
import {
  lastNewlineBoundary, nextNewlineBoundary, readLines, tailFingerprint,
} from './read-lines.js';
import { usageEnabled } from './settings.js';

/**
 * 全量扫描。见 design/token-tracking.md「统计合同」与「性能预算」。
 *
 * 三级读取策略，越靠前越便宜：
 *   1. `mtime:size` 签名未变        → 零磁盘读，直接复用缓存记录
 *   2. 纯追加（inode 与尾部指纹吻合）→ 只读新增字节，解析器从续读状态接着算
 *   3. 其余一切情况                  → 全量重读
 *
 * 第 2 级不是优化而是必需：Codex 单个 rollout 可达 290MB，活跃会话每次刷新都变，
 * 只有签名缓存的话每 30 秒就要重读 290MB。
 *
 * 冷建有工作预算，超时后存断点、下次继续，期间照常汇报进度，不把界面卡死。
 */

/**
 * 解析缓存的版本。
 *
 * **改了任何解析器的产出（字段、去重、项目归属…）都必须把它 +1**，
 * 否则已经解析过的文件会一直命中缓存、永远不重新解析，
 * 修复对存量数据静默不生效——你会看到「代码改了、数字没变」，
 * 而且没有任何东西提示你缓存才是原因。
 *
 * 10: 重建 Claude UUID 去重、Desktop Cowork roots、Codex 重放边界，并给
 *     缓存条目写入 source，以便 discovery 瞬时失败时安全回落。
 */
const CACHE_VERSION = 10;
const MAX_WARNINGS = 20;
const DEFAULT_BUDGET_MS = 20_000;

function budgetFromEnv() {
  const raw = Number(process.env.MACLAWD_SCAN_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MS;
}

export function listJsonl(baseDir, { extensions = ['.jsonl'], onError = null } = {}) {
  const results = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // 不存在表示工具没安装；权限/IO 错误则必须上报，否则空结果会被误认成精确零值。
      if (err?.code !== 'ENOENT') onError?.(dir, err);
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        try {
          const stat = statSync(full);
          results.push({
            path: full,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ino: stat.ino,
            relative: relativePath(baseDir, full),
          });
        } catch (err) {
          // 刚被删掉的文件可跳过；其他错误会使该来源不完整。
          if (err?.code !== 'ENOENT') onError?.(full, err);
        }
      }
    }
  };
  walk(baseDir);
  return results;
}

/**
 * 解析缓存的紧凑序列化。
 *
 * 逐字段对象存 8 万条记录会让缓存文件涨到 50MB 以上——大部分体积是重复的键名和
 * 默认值。改成「每文件一张模型表 + 定长数组」后同样的数据只占几分之一，
 * 而缓存是每次扫描都要整体读写的热路径，这个开销直接反映在启动时间上。
 */
function packRecords(records) {
  const models = [];
  const modelIndex = new Map();
  const rows = [];
  for (const r of records) {
    let mi = modelIndex.get(r.model);
    if (mi === undefined) {
      mi = models.length;
      models.push(r.model);
      modelIndex.set(r.model, mi);
    }
    rows.push([
      r.ts, r.input, r.output, r.cacheRead, r.write5m, r.write1h, r.reasoning, mi,
      r.messageId ?? 0, r.requestId ?? 0, r.uuid ?? 0, r.sidechain ? 1 : 0,
    ]);
  }
  return { m: models, r: rows };
}

function unpackRecords(packed, source, project) {
  if (!packed || !Array.isArray(packed.r)) return [];
  const models = packed.m ?? [];
  return packed.r.map((row) => ({
    source,
    project,
    ts: row[0],
    input: row[1],
    output: row[2],
    cacheRead: row[3],
    write5m: row[4],
    write1h: row[5],
    reasoning: row[6],
    model: models[row[7]] ?? 'unknown',
    messageId: row[8] || null,
    requestId: row[9] || null,
    uuid: row[10] || null,
    sidechain: row[11] === 1,
  }));
}

/** 同一 session 的多份物理文件里，哪一份更完整。 */
function isBetter(next, current) {
  if (!current) return true;
  if (next.size !== current.size) return next.size > current.size;
  if (next.mtimeMs !== current.mtimeMs) return next.mtimeMs > current.mtimeMs;
  return next.path.localeCompare(current.path) < 0;
}

/** 项目归属：取第一条非空 cwd 的末段目录名，之后 cd 不改变归属。 */
function projectFromRecords(records, fallback) {
  for (const record of records) {
    if (!record.cwd) continue;
    const trimmed = String(record.cwd).trim().replace(/[\\/]+$/, '');
    const name = trimmed.split(/[\\/]/).filter(Boolean).at(-1);
    if (name) return name;
  }
  return fallback || null;
}

/**
 * 项目的完整路径。面板的「项目足迹」要靠它在 Finder / 编辑器里打开项目
 * （tokei 的 ProjectTrail 是这个思路）；只有 basename 打不开任何东西。
 */
function projectPathFromRecords(records) {
  for (const record of records) {
    if (!record.cwd) continue;
    const trimmed = String(record.cwd).trim().replace(/[\\/]+$/, '');
    if (trimmed) return trimmed;
  }
  return null;
}

async function runParser(parser, candidate, { start, end, prevState }) {
  const fileParser = parser.createFileParser({
    state: prevState ?? null,
    candidate,
  });

  // 读取模式：
  //   'lines'（默认）逐行 JSONL
  //   'whole'         整份 JSON（amp 的 thread、Cline/Roo 的 taskHistory）
  //   'none'          解析器自己取数据（SQLite 库不能当文本读）
  const mode = parser.readMode ?? 'lines';
  if (mode === 'none') return fileParser.finish();

  if (mode === 'whole') {
    const chunks = [];
    await readLines(candidate.path, start, end, (line) => chunks.push(line));
    const text = chunks.join('\n');
    if (text.trim()) {
      try {
        fileParser.onObject(JSON.parse(text));
      } catch {
        // 文件正在被写、或历史文件损坏；下次签名变化时会重试。
      }
    }
    return fileParser.finish();
  }
  // lineFilter 可以是子串（最便宜）或谓词（Codex 需要匹配三类行）。
  // 为 null 时不过滤，代价是每行都要 JSON.parse。
  const filter = parser.lineFilter;
  const accept = typeof filter === 'function'
    ? filter
    : (typeof filter === 'string' && filter ? (line) => line.includes(filter) : null);

  await readLines(candidate.path, start, end, (line) => {
    try {
      fileParser.onRawLine?.(line);
    } catch {
      // 时间线等旁路解析失败不能影响用量主记录。
    }
    if (accept && !accept(line)) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // Claude/Codex 可能正在追写最后一行；历史坏行也在这里被隔离。
      return;
    }
    try {
      fileParser.onObject(obj);
    } catch {
      // 单条记录解析失败不应带掉整个文件。
    }
  });
  return fileParser.finish();
}

export async function scanAll({
  parsers = allParsers,
  onProgress,
  budgetMs = budgetFromEnv(),
  clock = Date.now,
  // 时间预算只能在文件之间检查；再给单文件一个字节上限，避免一个数百 MB
  // 的 JSONL 独占事件循环几分钟。后续轮次沿已有 offset 继续。
  maxFileBytes = 16 * 1024 * 1024,
  // 只有测试与「用户主动点重新扫描」之外的路径才需要绕过；默认必须尊重开关。
  ignoreSettings = false,
} = {}) {
  const startedAt = clock();

  // 主开关关在源头生效：一次 readdir 都不做。把闸设在这里而不是调用方，
  // 是为了让「关掉之后还在读日志」这种事在架构上不可能发生。
  if (!ignoreSettings && !usageEnabled()) {
    return {
      records: [],
      bySource: {},
      sessionsBySource: {},
      sourceStatus: {},
      projectPaths: {},
      warnings: [],
      stats: { reused: 0, appended: 0, full: 0, deferred: 0, bytesRead: 0 },
      elapsedMs: 0,
      indexing: null,
      disabled: true,
    };
  }
  const cached = readJson(SCAN_CACHE_FILE, null);
  const cache = (cached && cached.v === CACHE_VERSION && cached.files)
    ? cached
    : { v: CACHE_VERSION, files: {} };

  const warnings = [];
  const bySource = {};
  const sessionsBySource = {};
  const livePaths = new Set();
  const projectPaths = {};
  let cacheChanged = false;
  const stats = { reused: 0, appended: 0, full: 0, deferred: 0, bytesRead: 0 };
  const sourceStatus = {};

  const warn = (message) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
  };

  const restoreCachedSource = (parserId, records, sessions, status) => {
    for (const [path, entry] of Object.entries(cache.files)) {
      if (entry.source !== parserId || livePaths.has(path) || !entry.packed) continue;
      livePaths.add(path);
      status.indexedFiles++;
      for (const record of unpackRecords(entry.packed, parserId, entry.project)) {
        records.push(record);
      }
      if (entry.session) sessions.push({ ...entry.session, project: entry.project });
      if (entry.project && entry.projectPath) projectPaths[entry.project] = entry.projectPath;
    }
  };

  // 上一轮在哪个来源耗尽预算，下一轮就从那个来源开始。单纯固定顺序会让
  // Claude 的活跃大文件永远占满预算，后面的 Codex/Kimi 等来源永久饥饿。
  const resumeIndex = Math.max(0, parsers.findIndex((parser) => (
    parser.id === cache.scheduler?.nextParserId
  )));
  const orderedParsers = parsers.length > 0
    ? parsers.slice(resumeIndex).concat(parsers.slice(0, resumeIndex))
    : [];

  for (const parser of orderedParsers) {
    const status = sourceStatus[parser.id] = {
      discoveredFiles: 0,
      indexedFiles: 0,
      deferredFiles: 0,
      failedFiles: 0,
      complete: true,
      latestRecordAt: null,
    };
    let candidates;
    let discoveryErrors = 0;
    try {
      candidates = parser.discover({
        listJsonl: (baseDir, options = {}) => listJsonl(baseDir, {
          ...options,
          onError: (path, err) => {
            discoveryErrors++;
            status.failedFiles++;
            status.complete = false;
            options.onError?.(path, err);
            warn(`${parser.id}: 无法读取 ${path} — ${err.message}`);
          },
        }),
      });
    } catch (err) {
      status.failedFiles++;
      status.complete = false;
      warn(`${parser.id}: discover 失败 — ${err.message}`);
      const records = [];
      const sessions = [];
      restoreCachedSource(parser.id, records, sessions, status);
      bySource[parser.id] = dedupe(records);
      status.latestRecordAt = bySource[parser.id].reduce(
        (latest, record) => Math.max(latest ?? Number.NEGATIVE_INFINITY, record.ts), null,
      );
      sessionsBySource[parser.id] = sessions;
      continue;
    }

    // 同一 session id 出现在多个 root/目录时选最完整的一份，不求和。
    const groups = new Map();
    for (const candidate of candidates) {
      const key = candidate.sessionId ?? candidate.path;
      if (isBetter(candidate, groups.get(key))) groups.set(key, candidate);
    }

    const records = [];
    const sessions = [];
    status.discoveredFiles = groups.size;
    // 冷索引的第一屏服务于“今天用了多少”，不是历史考古。目录自然遍历通常
    // 从最旧年份开始，有限预算会让最近日志排在几百个旧文件之后，长时间显示
    // 假的今日 0。按修改时间倒序后，先产出今天，再在后续 catch-up 补历史。
    const orderedCandidates = [...groups.values()].sort((a, b) => (
      b.mtimeMs - a.mtimeMs || b.size - a.size || a.path.localeCompare(b.path)
    ));
    for (const candidate of orderedCandidates) {
      livePaths.add(candidate.path);
      const entry = cache.files[candidate.path];
      const sig = `${candidate.mtimeMs}:${candidate.size}`;

      // ---- 第 1 级：签名未变，零读取 ----
      if (entry && entry.sig === sig && entry.packed) {
        stats.reused++;
        status.indexedFiles++;
        for (const record of unpackRecords(entry.packed, parser.id, entry.project)) {
          records.push(record);
        }
        if (entry.session) sessions.push({ ...entry.session, project: entry.project });
        if (entry.project && entry.projectPath) projectPaths[entry.project] = entry.projectPath;
        continue;
      }

      // 预算耗尽：保留旧数据（若有），把这个文件留到下次。
      if (clock() - startedAt > budgetMs) {
        stats.deferred++;
        status.deferredFiles++;
        status.complete = false;
        if (entry?.packed) {
          status.indexedFiles++;
          for (const record of unpackRecords(entry.packed, parser.id, entry.project)) {
            records.push(record);
          }
        }
        continue;
      }

      // ---- 第 2 级：纯追加，只读新增字节 ----
      // 只有逐行追加的日志才能做增量尾读。
      let appended = false;
      if (
        (parser.readMode ?? 'lines') === 'lines'
        && entry
        && entry.packed
        && entry.ino === candidate.ino
        && typeof entry.offset === 'number'
        && candidate.size > entry.offset
      ) {
        const fingerprint = await tailFingerprint(candidate.path, entry.offset);
        if (fingerprint && fingerprint === entry.tail) {
          const fullBoundary = await lastNewlineBoundary(candidate.path, candidate.size);
          const cappedSize = Math.min(candidate.size, entry.offset + maxFileBytes);
          let boundary = fullBoundary;
          if (cappedSize < candidate.size) {
            const previousBoundary = await lastNewlineBoundary(candidate.path, cappedSize);
            boundary = previousBoundary > entry.offset
              ? previousBoundary
              : await nextNewlineBoundary(candidate.path, cappedSize, candidate.size) ?? fullBoundary;
          }
          if (boundary > entry.offset) {
            try {
              const result = await runParser(parser, candidate, {
                start: entry.offset,
                end: boundary,
                prevState: entry.state,
              });
              const project = entry.project
                ?? projectFromRecords(result.records, candidate.fallbackProject);
              const projectPath = entry.projectPath ?? projectPathFromRecords(result.records);
              for (const record of result.records) {
                record.project = project;
                delete record.cwd;
              }
              const merged = result.resetRecords
                ? result.records
                : unpackRecords(entry.packed, parser.id, project).concat(result.records);
              const partial = boundary < fullBoundary;
              cache.files[candidate.path] = {
                source: parser.id,
                sig: partial ? `partial:${candidate.mtimeMs}:${boundary}` : sig,
                ino: candidate.ino,
                offset: boundary,
                tail: await tailFingerprint(candidate.path, boundary),
                project,
                projectPath,
                state: result.state,
                session: result.session ?? null,
                packed: packRecords(merged),
              };
              cacheChanged = true;
              stats.appended++;
              if (partial) {
                stats.deferred++;
                status.deferredFiles++;
                status.complete = false;
              } else {
                status.indexedFiles++;
              }
              stats.bytesRead += boundary - entry.offset;
              for (const record of merged) records.push(record);
              if (result.session) sessions.push({ ...result.session, project });
              if (project && projectPath) projectPaths[project] = projectPath;
              appended = true;
              onProgress?.({ source: parser.id, path: candidate.path, mode: 'append' });
            } catch (err) {
              warn(`${parser.id}: 增量读失败，退回全量 ${candidate.path} — ${err.message}`);
            }
          } else {
            // 只增长了不完整的一行，等下次。
            stats.reused++;
            status.indexedFiles++;
            for (const record of unpackRecords(entry.packed, parser.id, entry.project)) {
              records.push(record);
            }
            appended = true;
          }
        }
      }
      if (appended) continue;

      // ---- 第 3 级：全量重读 ----
      try {
        const fullBoundary = await lastNewlineBoundary(candidate.path, candidate.size);
        const chunkable = (parser.readMode ?? 'lines') === 'lines';
        const cappedSize = chunkable ? Math.min(candidate.size, maxFileBytes) : candidate.size;
        let boundary = fullBoundary;
        if (cappedSize < candidate.size) {
          const previousBoundary = await lastNewlineBoundary(candidate.path, cappedSize);
          boundary = previousBoundary > 0
            ? previousBoundary
            : await nextNewlineBoundary(candidate.path, cappedSize, candidate.size) ?? fullBoundary;
        }
        const result = await runParser(parser, candidate, {
          start: 0,
          end: boundary,
          prevState: null,
        });
        const project = projectFromRecords(result.records, candidate.fallbackProject);
        const projectPath = projectPathFromRecords(result.records);
        if (project && projectPath) projectPaths[project] = projectPath;
        for (const record of result.records) {
          record.project = project;
          delete record.cwd;
        }
        const partial = chunkable && boundary < fullBoundary;
        cache.files[candidate.path] = {
          source: parser.id,
          sig: partial ? `partial:${candidate.mtimeMs}:${boundary}` : sig,
          ino: candidate.ino,
          offset: boundary,
          tail: await tailFingerprint(candidate.path, boundary),
          project,
          projectPath,
          state: result.state,
          session: result.session ?? null,
          packed: packRecords(result.records),
        };
        cacheChanged = true;
        stats.full++;
        if (partial) {
          stats.deferred++;
          status.deferredFiles++;
          status.complete = false;
        } else {
          status.indexedFiles++;
        }
        stats.bytesRead += boundary;
        for (const record of result.records) records.push(record);
        if (result.session) sessions.push({ ...result.session, project });
        onProgress?.({ source: parser.id, path: candidate.path, mode: 'full' });
      } catch (err) {
        status.failedFiles++;
        status.complete = false;
        warn(`${parser.id}: 无法读取 ${candidate.path} — ${err.message}`);
        // 读取失败时保留旧缓存，避免把一次瞬时故障变成数据缺口。
        if (entry?.packed) {
          status.indexedFiles++;
          for (const record of unpackRecords(entry.packed, parser.id, entry.project)) {
            records.push(record);
          }
        }
      }
    }

    // 某个 root 权限错误时，discover 可能仍返回其他 root 的候选。保留不可见
    // 分支上一次的缓存，并把来源标为不完整，不能把暂时看不见当成用户删除。
    if (discoveryErrors > 0) restoreCachedSource(parser.id, records, sessions, status);

    // 跨文件去重：fork 与 subagent 会把父会话记录复制到新文件。
    bySource[parser.id] = dedupe(records);
    status.latestRecordAt = bySource[parser.id].reduce(
      (latest, record) => Math.max(latest ?? Number.NEGATIVE_INFINITY, record.ts), null,
    );
    sessionsBySource[parser.id] = sessions;
  }

  const firstDeferredIndex = orderedParsers.findIndex((parser) => (
    sourceStatus[parser.id]?.deferredFiles > 0
  ));
  // 从耗尽预算的来源“后一个”开始，而不是再从它自己开始。否则一个拥有
  // 数百个慢文件的来源会连续占用很多轮，后面的来源虽非永久饥饿，却会等待过久。
  const nextParserId = firstDeferredIndex >= 0
    ? orderedParsers[(firstDeferredIndex + 1) % orderedParsers.length]?.id ?? null
    : null;
  if (cache.scheduler?.nextParserId !== nextParserId) {
    cache.scheduler = { nextParserId };
    cacheChanged = true;
  }

  // 逐出解析器已不再产出的文件（用户删了日志），防止缓存无界增长。
  for (const path of Object.keys(cache.files)) {
    if (!livePaths.has(path)) {
      delete cache.files[path];
      cacheChanged = true;
    }
  }

  if (cacheChanged) {
    try {
      writeJson(SCAN_CACHE_FILE, cache);
    } catch (err) {
      warn(`解析缓存写入失败（不影响本次结果）: ${err.message}`);
    }
  }

  const records = Object.values(bySource).flat();
  return {
    records,
    bySource,
    sessionsBySource,
    sourceStatus,
    projectPaths,
    warnings,
    stats,
    elapsedMs: clock() - startedAt,
    // 还有文件没来得及处理时，上层应显示「正在建立索引」，而不是把结果当完整数据。
    indexing: stats.deferred > 0 ? { deferred: stats.deferred } : null,
  };
}
