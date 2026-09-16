import { codexAttribution } from '../usage-attribution.js';
import { createHash } from 'node:crypto';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';

// Protocol: openai/codex d77ebc7. Replay/continuation behavior independently
// implemented against vibe-usage fcf1c398 (npm 0.10.31). No prompt/tool text
// enters this disposable index: retain only accounting fields and hashes.
const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const digest = obj => createHash('sha256').update(JSON.stringify(obj)).digest('base64url');
const timestamp = value => value == null || value === '' || !Number.isFinite(new Date(value).getTime())
  ? null : new Date(value).getTime();
const usage = obj => obj ? fields.map(key => toCount(obj[key] ?? (key === 'cached_input_tokens' ? obj.cache_read_input_tokens : null))) : null;

export function createAccountingIndex(previous) {
  const state = previous ?? { events: [], model: null, time: null, pending: [] };
  return {
    advance(ts) {
      if (ts == null) return;
      state.time = Math.max(state.time ?? -Infinity, ts);
      for (const index of state.pending) state.events[index].at = state.time;
      state.pending = [];
    },
    onObject(obj) {
      const p = obj?.payload;
      if (!p) return;
      const ts = timestamp(obj.timestamp);
      this.advance(ts);
      let event;
      if (obj.type === 'session_meta') {
        event = { kind: 'meta', usageSource: codexAttribution(p), id: p.id || p.session_id || null, cwd: p.cwd || null,
          start: timestamp(p.timestamp) ?? ts, fork: p.forked_from_id || null,
          parent: p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id || null,
          sub: p.thread_source === 'subagent' || p.source === 'subagent'
            || !!(p.source && typeof p.source === 'object' && 'subagent' in p.source) || p.parent_thread_id != null };
      } else if (obj.type === 'turn_context' || p.type === 'thread_settings_applied') {
        const settings = obj.type === 'turn_context' ? p : p.thread_settings;
        if (settings?.model) state.model = settings.model;
        // Context is captured on each usage event; unrelated context lines must
        // not introduce contradictory edges when overlapping segments merge.
        return;
      } else if (obj.type === 'event_msg' && (p.type === 'task_started' || p.type === 'turn_started')) {
        const n = p.started_at == null || p.started_at === '' ? NaN : Number(p.started_at);
        event = { kind: 'task', start: Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : null };
      } else if (obj.type === 'event_msg' && p.type === 'token_count') {
        event = { kind: 'token', fingerprint: digest(p).slice(0, 16),
          total: usage(p.info?.total_token_usage), last: usage(p.info?.last_token_usage),
          model: p.info?.model || p.model || state.model || UNKNOWN_MODEL,
          at: ts == null ? null : state.time };
      } else return;
      event.ts = ts;
      event.key = digest(obj);
      state.events.push(event);
      if (event.kind === 'token' && ts == null) state.pending.push(state.events.length - 1);
    },
    state: () => state,
  };
}

// Exact cross-file copies merge with occurrence counts. Repetitions in a
// single file survive. Topological order preserves counter resets and copied
// history even when timestamps run backwards; timestamps order disjoint parts.
function mergeSegments(members) {
  if (members.length === 1) return members[0].state.accounting.events;
  const sorted = [...members].sort((a, b) => {
    const firstTime = entry => entry.state.accounting.events.find(e => e.kind === 'token' && e.ts != null)?.ts ?? Infinity;
    return firstTime(a) - firstTime(b) || a.path.localeCompare(b.path);
  });
  const nodes = new Map();
  for (const member of sorted) {
    const counts = new Map();
    let previous;
    for (const event of member.state.accounting.events) {
      const count = (counts.get(event.key) ?? 0) + 1;
      counts.set(event.key, count);
      const key = `${event.key}:${count}`;
      if (!nodes.has(key)) nodes.set(key, { event, order: nodes.size, next: new Set(), incoming: 0 });
      const node = nodes.get(key);
      if (previous && !previous.next.has(node)) { previous.next.add(node); node.incoming++; }
      previous = node;
    }
  }
  const ready = [...nodes.values()].filter(n => n.incoming === 0);
  const events = [];
  while (ready.length) {
    ready.sort((a, b) => (a.event.ts != null && b.event.ts != null ? a.event.ts - b.event.ts : 0) || a.order - b.order);
    const node = ready.shift();
    events.push(node.event);
    for (const child of node.next) if (--child.incoming === 0) ready.push(child);
  }
  if (events.length !== nodes.size) throw new Error('Codex 同一会话分段顺序冲突，保留上次统计');
  return events;
}

function indexSession(members) {
  const events = mergeSegments(members);
  const meta = events.find(e => e.kind === 'meta') ?? {};
  const tokens = [], tasks = [];
  let time = -Infinity;
  for (const event of events) {
    if (event.ts != null) time = Math.max(time, event.ts);
    if (event.kind === 'token') tokens.push({ ...event, at: event.at == null ? Infinity : Math.max(time, event.at) });
    if (event.kind === 'task') tasks.push({ count: tokens.length, start: event.start });
  }
  return { ...meta, tokens, tasks, metaCount: events.filter(e => e.kind === 'meta').length, members };
}

// KMP computes both the completed suffix and the longest partial copy in one
// pass, with O(parent + child) cost even for repetitive zero-usage emissions.
function overlaps(child, parent) {
  if (!child.length || !parent.length) return { suffix: 0, partial: 0 };
  const pattern = child.map(e => e.fingerprint), table = new Array(child.length).fill(0);
  for (let i = 1, matched = 0; i < pattern.length; i++) {
    while (matched && pattern[i] !== pattern[matched]) matched = table[matched - 1];
    if (pattern[i] === pattern[matched]) matched++;
    table[i] = matched;
  }
  let matched = 0, partial = 0;
  for (const token of parent) {
    if (matched === pattern.length) matched = table[matched - 1];
    while (matched && token.fingerprint !== pattern[matched]) matched = table[matched - 1];
    if (token.fingerprint === pattern[matched]) matched++;
    partial = Math.max(partial, matched);
  }
  return { suffix: matched, partial };
}

function replayCount(session, byId) {
  const parent = byId.get(session.fork || (session.sub ? session.parent : null));
  const snapshot = parent && session.start != null ? parent.tokens.filter(t => t.at <= session.start) : [];
  const { suffix, partial } = overlaps(session.tokens, snapshot);
  if (!session.sub) return session.fork ? suffix : 0;
  const matched = suffix ? session.tasks.filter(t => t.count === suffix && t.start != null
    && session.start != null && t.start >= Math.floor(session.start / 1000) * 1000).at(-1) : null;
  const nearStart = session.tasks.filter(t => t.start != null && session.start != null
    && Math.abs(t.start - session.start) <= 5000).at(-1);
  const direct = matched || nearStart || (session.metaCount === 1 && !session.fork ? session.tasks[0] : null);
  return Math.max(suffix, partial, direct?.count ?? 0);
}

function recordsFor(session, skip) {
  let previous = null, previousTotal = null;
  const records = [];
  const project = session.cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || null;
  for (const [ordinal, event] of session.tokens.entries()) {
    const current = event.total;
    const duplicate = current?.[5] > 0 && current[5] === previousTotal;
    let delta = event.last;
    if (!delta && current) {
      delta = previous ? current.map((value, index) => value - previous[index]) : current;
      // total_tokens is auxiliary; resets are detected on the actual counters.
      if (delta.slice(0, 5).some(value => value < 0)) delta = current;
    }
    if (current) { previous = current; previousTotal = current[5]; }
    if (ordinal < skip || duplicate || !delta || event.ts == null) continue;
    const [input, cached, write, output, reasoning] = delta;
    if (input + cached + write + output === 0) continue;
    records.push({ source: 'codex', ...(session.usageSource ? { usageSource: session.usageSource } : {}), project, ts: event.ts, model: event.model,
      input: Math.max(0, input - cached - write), cacheRead: cached, write5m: write, write1h: 0,
      output, reasoning: Math.min(output, reasoning),
      // Identity is scoped to the logical session, never a global numeric hash.
      messageId: `${session.id}:${ordinal}`, requestId: null, uuid: null, sidechain: false });
  }
  return records;
}

export function reconcileSource(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.state?.accounting) continue;
    const id = entry.state.accounting.events.find(e => e.kind === 'meta')?.id || entry.path;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  const byId = new Map([...groups].map(([id, members]) => [id, { ...indexSession(members), id }]));
  const records = [], sessions = [];
  function origin(session, seen = new Set()) {
    if (session.usageSource || seen.has(session.id)) return session.usageSource;
    seen.add(session.id);
    const parent = session.sub && byId.get(session.parent);
    return parent ? origin(parent, seen) : null;
  }
  for (const session of byId.values()) {
    session.usageSource = origin(session);
    records.push(...recordsFor(session, replayCount(session, byId)));
    // Do not add overlapping physical-file timing summaries. Keep the most
    // complete summary until message timelines have their own merge contract.
    const summary = session.members.filter(e => e.session).sort((a, b) => b.session.messageCount - a.session.messageCount)[0];
    if (summary) sessions.push({ ...summary.session, project: summary.project, ...(session.usageSource ? { usageSource: session.usageSource } : {}) });
  }
  return { records, sessions };
}
