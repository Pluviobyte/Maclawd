import { homedir, platform } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';

export const id = 'trae-cli';
export const label = 'Trae CLI';
export const lineFilter = '"usage.';

/**
 * ⚠️ 未在真实数据上验证（开发机未安装 Trae CLI）。口径依据 vibe-usage 的实现推导。
 *
 * 只覆盖 Trae **CLI** 的遥测，Trae IDE / Trae Work 的对话不在此列。
 */
export function sessionsDir() {
  const override = process.env.MACLAWD_TRAE_CLI_DIR?.trim();
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Caches', 'trae-cli', 'sessions');
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local');
    return join(local, 'trae-cli', 'cache', 'sessions');
  }
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'trae-cli', 'sessions');
}

export function dataDirs() {
  return [sessionsDir()];
}

export function discover({ listJsonl }) {
  const base = sessionsDir();
  return listJsonl(base)
    .filter(({ path }) => path.endsWith('traces.jsonl'))
    .map(({ path, size, mtimeMs, ino, relative }) => ({
      path, size, mtimeMs, ino,
      sessionId: relative.split(sep)[0] || path,
      fallbackProject: null, cacheKey: metadataSignature(path),
    }));
}

/** tag 可能是 [{key,value}] 数组，也可能是扁平对象，两种都接。 */
function tagMap(span) {
  const out = {};
  const tags = span?.tags ?? span?.attributes ?? span;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (tag && typeof tag.key === 'string') out[tag.key] = tag.value;
    }
  } else if (tags && typeof tags === 'object') {
    Object.assign(out, tags);
  }
  return out;
}

function metadataSignature(path) {
  try { const s = statSync(join(dirname(path), 'session.json')); return `${s.mtimeMs}:${s.size}`; }
  catch (e) { if (e.code !== 'ENOENT') throw e; return ''; }
}
function metadata(path) {
  if (!path) return {};
  try {
    const file = join(dirname(path), 'session.json');
    if (statSync(file).size > 1024 * 1024) throw new Error('Trae session metadata 超出大小限制');
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return { cwd: obj.metadata?.cwd, model: obj.metadata?.model_name };
  } catch (e) { if (e.code !== 'ENOENT') throw e; return {}; }
}

// Vibe fcf1c398 / PR65: authoritative span layers, microseconds, separate reasoning.
// Product field semantics remain unverified by local real samples.
export function createFileParser({ candidate, state } = {}) {
  const spans = new Map(state?.spans ?? []);
  const meta = metadata(candidate?.path);
  let anonymous = state?.anonymous ?? 0;
  return {
    onObject(obj) {
      if (!obj || typeof obj !== 'object') return;
      const tags = tagMap(obj);
      const input = toCount(tags['usage.input_tokens']);
      const output = toCount(tags['usage.output_tokens']);
      const cacheRead = toCount(tags['usage.cache_read_tokens']);
      const cacheWrite = toCount(tags['usage.cache_write_tokens']);
      const reasoning = toCount(tags['usage.reasoning_tokens']);
      if (input + output + cacheRead + cacheWrite + reasoning === 0) return;
      const stamp = obj.timestamp ?? obj.start_time ?? tags['start.time'];
      const ts = obj.startTime != null ? Number(obj.startTime) / 1000
        : typeof stamp === 'number' ? (stamp > 1e12 ? stamp : stamp * 1000) : Date.parse(stamp);
      if (!Number.isFinite(ts) || ts <= 0 || ts > 1e14) return;
      const key = obj.spanID ?? obj.spanId ?? obj.span_id ?? obj.id ?? `anonymous:${anonymous++}`;
      const prev = spans.get(key);
      const merged = {
        input: Math.max(prev?.input ?? 0, input),
        output: Math.max(prev?.output ?? 0, output),
        cacheRead: Math.max(prev?.cacheRead ?? 0, cacheRead),
        cacheWrite: Math.max(prev?.cacheWrite ?? 0, cacheWrite),
        reasoning: Math.max(prev?.reasoning ?? 0, reasoning),
        ts: prev?.ts ?? ts,
        category: tags['span.category'] ?? prev?.category ?? '',
        model: tags['model.name'] ?? tags['semantic.name'] ?? tags['llm.model'] ?? tags.model ?? prev?.model,
        cwd: tags.cwd ?? obj.cwd ?? prev?.cwd,
      };
      spans.set(key, merged);
    },
    finish() {
      const categories = new Set([...spans.values()].map(s => s.category));
      const preferred = ['model.stream.eino','model.generate'].some(c => categories.has(c))
        ? new Set(['model.stream.eino','model.generate']) : categories.has('model.real_call')
          ? new Set(['model.real_call']) : categories.has('model.call') ? new Set(['model.call']) : null;
      const records = [];
      for (const [key, span] of spans) {
        if (preferred && !preferred.has(span.category)) continue;
        records.push({
          source: id, input: span.input, output: span.output + span.reasoning,
          cacheRead: span.cacheRead, write5m: span.cacheWrite, write1h: 0, reasoning: span.reasoning,
          billing: { promptTokens: span.input + span.cacheRead + span.cacheWrite,
            ...(span.cacheWrite ? { unknownWriteTTL: true } : {}) },
          model: String(span.model ?? meta.model ?? UNKNOWN_MODEL).trim() || UNKNOWN_MODEL,
          cwd: span.cwd ?? meta.cwd ?? null, ts: span.ts,
          messageId: `${candidate?.sessionId ?? ''}|${key}`, requestId: null, uuid: null, sidechain: false,
        });
      }
      // Appending a primary span invalidates previously selected fallback spans.
      return { records, resetRecords: true, state: { spans: [...spans], anonymous } };
    },
  };
}
