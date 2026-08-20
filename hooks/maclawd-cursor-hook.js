#!/usr/bin/env node
/**
 * Cursor stop 用量写入器。
 *
 * Cursor 通过 stdin 送来完整 hook payload；这里采用严格白名单，只把模型、四类
 * token、generation id 与本机时间写入 Maclawd 数据目录。prompt、邮箱、项目路径、
 * transcript 等字段从未进入落盘对象。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { usageDir } from '../src/runtime/paths.js';
import { readEndpoint } from '../src/runtime/endpoint.js';

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

async function notifyRuntime() {
  const endpoint = readEndpoint();
  if (!endpoint) return;
  try {
    await fetch(`http://127.0.0.1:${endpoint.port}/api/scan/kick`, {
      method: 'POST', signal: AbortSignal.timeout(150),
    });
  } catch {
    // App 没开或正在重启时，JSONL 已经落盘，下次启动会扫描。
  }
}

async function main() {
  let payload;
  try {
    const raw = readFileSync(0, { encoding: 'utf8' });
    if (raw.length > 1 << 20) return;
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (payload?.hook_event_name && payload.hook_event_name !== 'stop') return;

  const inputTokens = count(payload?.input_tokens);
  const outputTokens = count(payload?.output_tokens);
  const cacheReadTokens = count(payload?.cache_read_tokens);
  const cacheWriteTokens = count(payload?.cache_write_tokens);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return;

  const ts = Date.now();
  const generationId = typeof payload?.generation_id === 'string'
    && payload.generation_id.trim() ? payload.generation_id.trim() : randomUUID();
  const rawModel = String(payload?.model_id ?? payload?.model ?? '').trim();
  const record = {
    source: 'cursor',
    generationId,
    model: rawModel || 'unknown',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ts,
  };

  const dir = join(usageDir(), 'cursor-hooks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const day = new Date(ts).toISOString().slice(0, 10);
  appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify(record)}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
  await notifyRuntime();
}

try { await main(); } catch { /* Hook 永远不能污染或阻断 Cursor。 */ }
