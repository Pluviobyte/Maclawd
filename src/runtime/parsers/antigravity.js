import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';
import { queryDbJson, sqliteParser } from './sqlite.js';
import { decodeMessage, firstMessage, firstString, firstVarint } from './protobuf.js';

export const id = 'antigravity';
export const label = 'Antigravity';

/**
 * ⚠️ 未在真实数据上验证（开发机未安装 Antigravity）。
 *
 * Antigravity 把每个会话存成一个 SQLite `.db`，用量在 `gen_metadata` 表里，
 * 值是 **protobuf blob**。字段号是 vibe-usage 逆向出来的，本项目无法独立验证。
 *
 * 因此这里刻意做了**结构自校验**：必须能依次解出 `1 → 4` 两层嵌套消息，
 * 且四个 token 字段至少一个非零，否则返回 null。schema 猜错的结果是
 * 「读不到数据」，而不是「读出错误数字」——按本项目的原则，后者严重得多。
 *
 * 只实现离线 SQLite 路径。vibe-usage 还有一条对旧版 `.pb` 历史走 Connect RPC 的
 * 回落，需要语言服务器在跑，不适合桌宠的后台采集。
 */
const CONVERSATION_DIRS = ['antigravity', 'antigravity-cli'];

export function conversationDirs() {
  const override = process.env.MACLAWD_ANTIGRAVITY_DIR?.trim();
  if (override) return [override];
  const base = join(homedir(), '.gemini');
  return CONVERSATION_DIRS.map((name) => join(base, name, 'conversations'));
}

export function dataDirs() {
  return conversationDirs();
}

/**
 * gen_metadata blob → 用量记录。字段映射：
 *   1        chatModel
 *   1.4      usage
 *   1.4.2    inputTokens      1.4.3  outputTokens
 *   1.4.5    cacheReadTokens  1.4.9  thinkingOutputTokens
 *   1.4.11   responseId       （天然的去重键）
 *   1.9.4.1  createdAt 秒
 *   1.19     responseModel    1.21   displayName
 */
export function parseGenMetadata(buf) {
  let root;
  try {
    root = decodeMessage(buf);
  } catch {
    return null;
  }
  const chatModel = firstMessage(root, 1);
  if (!chatModel) return null;
  const usage = firstMessage(chatModel, 4);
  if (!usage) return null;

  const input = toCount(firstVarint(usage, 2));
  const output = toCount(firstVarint(usage, 3));
  const cacheRead = toCount(firstVarint(usage, 5));
  const thinking = toCount(firstVarint(usage, 9));
  // 全零说明这条是报错或只做规划的步骤——也可能是 schema 猜错了。两种都跳过。
  if (input + output + cacheRead + thinking === 0) return null;

  const startMeta = firstMessage(chatModel, 9);
  const createdAt = startMeta ? firstMessage(startMeta, 4) : undefined;
  const seconds = createdAt ? firstVarint(createdAt, 1) : undefined;
  if (!seconds) return null;

  return {
    input,
    output,
    cacheRead,
    thinking,
    responseId: firstString(usage, 11) || '',
    ts: seconds * 1000,
    model: firstString(chatModel, 21) || firstString(chatModel, 19) || UNKNOWN_MODEL,
  };
}

function workspaceUri(path) {
  try {
    const rows = queryDbJson(path, 'SELECT hex(data) AS h FROM trajectory_metadata_blob LIMIT 1');
    if (!rows?.[0]?.h) return null;
    const meta = decodeMessage(Buffer.from(rows[0].h, 'hex'));
    const workspace = firstMessage(meta, 1);
    return (workspace && firstString(workspace, 1)) || null;
  } catch {
    return null;
  }
}

function rowsToRecords(path) {
  let rows;
  try {
    rows = queryDbJson(path, 'SELECT hex(data) AS h FROM gen_metadata ORDER BY idx');
  } catch {
    // 这个库没有该表（不是会话库），静默跳过
    return [];
  }

  const uri = workspaceUri(path);
  const cwd = uri ? decodeURIComponent(uri.replace(/^file:\/\//, '')) : null;
  const cascade = basename(path, '.db');
  const records = [];

  rows.forEach((row, index) => {
    if (!row.h) return;
    const parsed = parseGenMetadata(Buffer.from(row.h, 'hex'));
    if (!parsed) return;
    records.push({
      source: id,
      input: parsed.input,
      output: parsed.output + parsed.thinking,
      cacheRead: parsed.cacheRead,
      write5m: 0,
      write1h: 0,
      // 字段独立上报，为满足不变量 2 把 thinking 并进 output 并保留子计数。
      reasoning: parsed.thinking,
      model: String(parsed.model).trim() || UNKNOWN_MODEL,
      cwd,
      ts: parsed.ts,
      messageId: parsed.responseId || `${cascade}|${index}`,
      requestId: null,
      uuid: null,
      sidechain: false,
    });
  });
  return records;
}

function dbPaths() {
  const paths = [];
  for (const dir of conversationDirs()) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.db') || name === 'db.sqlite') continue;
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        paths.push({ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino });
      } catch {
        // 刚被删掉
      }
    }
  }
  return paths;
}

const parser = sqliteParser({ id, rowsToRecords, dbPaths });
export const { readMode, discover, createFileParser } = parser;
export const lineFilter = null;
