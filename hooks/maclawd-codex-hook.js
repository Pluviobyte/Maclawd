#!/usr/bin/env node
import { discoverPort } from '../src/runtime/endpoint.js';
import { buildCodexEvent } from '../src/runtime/codex-hook-event.js';
import { writeLease, dropLease } from '../src/runtime/session-lease.js';

const MAX_BYTES = 1 << 20;

async function stdin() {
  if (process.stdin.isTTY) return {};
  let body = '';
  for await (const chunk of process.stdin) {
    body += chunk;
    if (body.length >= MAX_BYTES) break;
  }
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

async function post(path, payload, timeoutMs) {
  const port = discoverPort();
  if (!port) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    return response.ok ? await response.json() : {};
  } catch { return {}; } finally { clearTimeout(timer); }
}

const LEASE_STATE = {
  SessionStart: 'thinking', UserPromptSubmit: 'thinking', PreToolUse: 'working',
  PostToolUse: 'working', SubagentStart: 'delegating', SubagentStop: 'working',
  PreCompact: 'compacting', PostCompact: 'working',
};

async function main() {
  const payload = await stdin();
  const eventName = process.argv[2] || payload.hook_event_name;
  if (!eventName) return;
  if (eventName === 'PermissionRequest') {
    const decision = await post('/api/permission?agent=codex', payload, 27_000);
    process.stdout.write(`${JSON.stringify(decision || {})}\n`);
    return;
  }
  const event = buildCodexEvent(eventName, payload);
  try {
    if (eventName === 'SessionEnd') dropLease(event.sessionId, 'codex');
    else if (LEASE_STATE[eventName]) writeLease({
      sessionId: event.sessionId,
      state: event.commandClass ?? LEASE_STATE[eventName],
      pid: event.pid, cwd: event.cwd, agentId: 'codex',
    });
  } catch { /* hook failures never affect Codex */ }
  await post('/api/event', event, 1_500);
}

await main();
