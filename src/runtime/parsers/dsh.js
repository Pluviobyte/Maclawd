import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { decodeZstdFrames } from './zstd-frames.js';
import { timestamp } from './local-data.js';
import { UNKNOWN_MODEL, throughput } from '../usage-record.js';

export const id = 'dsh';
export const label = 'DeepSeek Harness';
export const lineFilter = null;
const countFields = ['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'];
const lifecycle = new Set(['turn/start','turn/end','step/start','step/end','assistant/message','assistant/attempt','llm/retry','llm/retry-started','session/end-seed']);
const count = n => Number.isSafeInteger(n) && n >= 0;
function home() {
  const value = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return resolve(value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
}
export const dataDirs = () => [home()];
export function discover({ listJsonl }) {
  const generations = new Map();
  for (const file of listJsonl(join(home(), 'sessions'), { extensions: ['.jsonl', '.jsonl.zstd'] })) {
    const match = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/.exec(basename(file.path));
    if (!match) continue;
    const version = Number(match[1] || 0), key = dirname(file.path), compressed = Boolean(match[2]);
    const previous = generations.get(key);
    if (previous && (previous.version > version || (previous.version === version && !previous.compressed))) continue;
    generations.set(key, { ...file, version, compressed, sessionId: key, readMode: compressed ? 'none' : 'lines' });
  }
  return [...generations.values()];
}

function usageOnly(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return Object.fromEntries(countFields.filter(key => Object.hasOwn(usage, key))
    .map(key => [key, typeof usage[key] === 'number' ? usage[key] : null]));
}
function lastUsage(data) {
  if (data.usage != null) return usageOnly(data.usage);
  let result = null;
  for (const item of Array.isArray(data.stream) ? data.stream : []) {
    if (item?.type === 'chunk' && item.chunk?.type === 'usage') result = usageOnly(item.chunk.usage);
  }
  return result;
}

/** Persist only accounting metadata, never the assistant stream or message body. */
export function createFileParser({ candidate, state } = {}) {
  let header = state?.header ?? null, error = state?.error ?? null, lastSeq = state?.lastSeq ?? -1;
  const events = [...(state?.events ?? [])];
  const onObject = obj => {
    if (obj?.type === 'session') {
      if (header) { error = '重复 session header'; return; }
      header = { version: typeof obj.version === 'number' ? obj.version : null,
        id: typeof obj.id === 'string' ? obj.id : null, cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
        parentSession: typeof obj.parentSession === 'string' ? obj.parentSession : null,
        isSeeded: typeof obj.isSeeded === 'boolean' ? obj.isSeeded : null,
        seedLength: obj.seedLength === undefined ? undefined : typeof obj.seedLength === 'number' ? obj.seedLength : null };
      return;
    }
    if (!header || !count(obj?.seq) || obj.seq !== lastSeq + 1) { error = '日志序列不完整'; return; }
    lastSeq = obj.seq;
    if (!lifecycle.has(obj.type)) return;
    const d = obj.data ?? {};
    events.push({ type: obj.type, seq: obj.seq, time: timestamp(obj.time),
      turn: typeof d.turn === 'number' ? d.turn : null, step: typeof d.step === 'number' ? d.step : null,
      usage: lastUsage(d), messageId: typeof d.message?.id === 'string' ? d.message.id : null,
      model: typeof d.message?.source?.model === 'string' ? d.message.source.model : null,
      inherited: d.inherited === true });
  };
  return {
    onObject,
    async finish() {
      if (candidate?.compressed) {
        if (candidate.size > 256 * 1024 * 1024) throw new Error('DSH 压缩文件超出大小限制');
        const payload = await readFile(candidate.path);
        if (payload.length > 256 * 1024 * 1024) throw new Error('DSH 压缩文件超出大小限制');
        const { chunks, incomplete } = decodeZstdFrames(payload);
        const decoder = new StringDecoder('utf8'); let pending = '';
        for (const chunk of chunks) {
          pending += decoder.write(chunk);
          let end;
          while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            if (line.trim()) onObject(JSON.parse(line));
          }
          if (pending.length > 16 * 1024 * 1024) throw new Error('DSH 日志行超出大小限制');
        }
        if (incomplete || pending || decoder.end()) error = '日志尾部尚未写完';
      }
      if (!header || !count(header.version) || header.version > 3 || header.version !== candidate?.version
        || typeof header.id !== 'string' || !header.id) throw new Error('DSH Session 格式不受支持');
      if (header.version >= 2 && typeof header.isSeeded !== 'boolean') throw new Error('DSH seed metadata 无效');
      if (error && error !== '日志尾部尚未写完') throw new Error(`DSH ${error}`);
      return { records: [], state: { header, events, lastSeq, error },
        projectPaths: header.cwd ? { [basename(header.cwd)]: header.cwd } : {} };
    },
  };
}

function normalized(usage) {
  if (!usage || !count(usage.inputTokens) || !count(usage.outputTokens)) return null;
  if (countFields.some(k => usage[k] !== undefined && !count(usage[k]))) return null;
  if ((usage.reasoningTokens ?? 0) > usage.outputTokens) return null;
  const prompt = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const total = prompt + usage.outputTokens;
  if (!Number.isSafeInteger(total)) return null;
  if (usage.totalTokens !== undefined && (usage.totalTokens < total
    || (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined && usage.totalTokens !== total))) return null;
  // An exact total cannot reveal how an unreported cache remainder was split.
  const exact = usage.totalTokens === total || (usage.totalTokens === undefined
    && usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined);
  return { input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens ?? 0,
    write5m: usage.cacheWriteTokens ?? 0, write1h: 0, reasoning: usage.reasoningTokens ?? 0,
    exact, billing: { promptTokens: exact ? prompt : null,
      ...(!exact ? { serviceTier: 'unreported' } : {}),
      ...(usage.cacheWriteTokens > 0 ? { unknownWriteTTL: true } : {}) } };
}

// Independently derived from official deepseek-harness 0d1f5000 attempt lifecycle.
// Samples describe a request; only explicit boundaries open/close requests.
export function accountEvents(header, events) {
  const records = []; let complete = true, turn = null;
  const settle = event => {
    const usage = normalized(event.usage);
    if (!usage || event.time === null) { turn.invalid = true; return; }
    const { exact, ...buckets } = usage;
    if (!exact) complete = false;
    const model = typeof event.model === 'string' && event.model ? event.model : UNKNOWN_MODEL;
    turn.records.push({ source: id, ...buckets, model, ts: event.time,
      cwd: header.cwd, project: header.cwd ? basename(header.cwd) : null,
      messageId: JSON.stringify([header.id, turn.id, turn.step, turn.ordinal]),
      requestId: null, uuid: null, sidechain: false, seq: event.seq, proofID: event.messageId });
  };
  for (const event of events) {
    if (event.type === 'session/end-seed') continue;
    if (event.type === 'turn/start') {
      if (turn) complete = false;
      turn = { id: event.turn, step: null, ordinal: 0, phase: 'idle', records: [], invalid: !count(event.turn) };
      continue;
    }
    if (!turn) { complete = false; continue; }
    if (event.turn !== turn.id) { turn.invalid = true; continue; }
    if (event.type === 'turn/end') {
      if (turn.invalid || turn.phase !== 'idle') complete = false;
      else records.push(...turn.records);
      turn = null; continue;
    }
    if (event.type === 'step/start') {
      if (turn.phase !== 'idle' || !count(event.step)) turn.invalid = true;
      turn.step = event.step; turn.ordinal++; turn.phase = 'open'; continue;
    }
    if (event.step !== turn.step || turn.phase === 'idle') { turn.invalid = true; continue; }
    if (event.type === 'llm/retry-started') {
      if (turn.phase !== 'retry') turn.invalid = true;
      turn.ordinal++; turn.phase = 'open';
    } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      if (turn.phase !== 'open') { turn.invalid = true; continue; }
      settle(event); turn.phase = event.type === 'assistant/message' ? 'message' : 'finished';
    } else if (event.type === 'llm/retry') {
      if (turn.phase !== 'finished') turn.invalid = true;
      turn.phase = 'retry';
    } else if (event.type === 'step/end') {
      if (turn.phase === 'open') turn.invalid = true;
      turn.phase = 'idle';
    }
  }
  if (turn) complete = false;
  return { records, complete };
}

function inheritedBoundary(header, events) {
  if (header.version < 2) {
    if (header.seedLength !== undefined && !count(header.seedLength)) throw new Error('DSH seedLength 无效');
    return header.seedLength ?? 0;
  }
  const markers = events.filter(e => e.type === 'session/end-seed' && e.inherited);
  if (header.isSeeded !== (markers.length > 0)) throw new Error('DSH seed 标记不完整');
  return markers.at(-1)?.seq ?? 0;
}
function sameUsage(a, b) {
  return a.model === b.model && a.ts === b.ts && ['input','output','cacheRead','write5m','write1h','reasoning'].every(k => a[k] === b[k]);
}
export function reconcileSource(entries) {
  const sessions = new Map(); let complete = true;
  for (const entry of entries) {
    const { header, events, error } = entry.state ?? {};
    if (!header) { complete = false; continue; }
    const result = accountEvents(header, events);
    const boundary = inheritedBoundary(header, events);
    if (sessions.has(header.id)) throw new Error('DSH 会话身份重复');
    sessions.set(header.id, { header, events, boundary, records: result.records });
    if (!result.complete || error) complete = false;
  }
  const records = [];
  for (const session of sessions.values()) {
    const parent = sessions.get(session.header.parentSession);
    const inherited = session.records.filter(r => r.seq < session.boundary);
    let parentIndex = -1, proven = inherited.length > 0 && Boolean(parent);
    if (proven) for (const child of inherited) {
      const index = parent.records.findIndex((record, i) => i > parentIndex && sameUsage(child, record)
        && (parent.header.version === session.header.version ? child.seq === record.seq
          : Boolean(child.proofID) && child.proofID === record.proofID));
      if (index < 0) { proven = false; break; }
      parentIndex = index;
    }
    if (inherited.length && !proven) complete = false;
    for (const record of session.records) {
      if (proven && record.seq < session.boundary) continue;
      if (!throughput(record)) continue;
      const { seq, proofID, cwd, ...publicRecord } = record;
      records.push(publicRecord);
    }
  }
  return { records, sessions: [], complete,
    ...(complete ? {} : { warning: 'DSH 含未闭合请求、缺失用量或未能证明的继承记录，统计暂不完整' }) };
}
