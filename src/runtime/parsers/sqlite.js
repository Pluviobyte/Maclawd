import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * SQLite 只读查询。优先用 Node 内置 `node:sqlite`（Node ≥ 22.5，Windows 免装二进制），
 * 老版本回落到系统 `sqlite3` CLI。
 *
 * 行的形状与 `sqlite3 -json` 一致：`{ 列名: 值 }`。
 */

let DatabaseSync = null;
let checked = false;

function loadNative() {
  if (checked) return DatabaseSync;
  checked = true;
  try {
    // 用 require 风格的动态导入以便在不支持时静默回落
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    DatabaseSync = null;
  }
  return DatabaseSync;
}

function queryNative(dbPath, sql) {
  const Native = loadNative();
  if (!Native) return null;
  const db = new Native(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function queryCli(dbPath, sql) {
  const out = execFileSync('sqlite3', ['-json', '-readonly', dbPath, sql], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const text = out.trim();
  return text ? JSON.parse(text) : [];
}

/**
 * 源应用（Cursor / Kiro）会持有写锁。遇到 "database is locked" 时把库连同
 * -wal / -shm 复制到临时目录再查快照——这是 vibe-usage 的做法，很有必要，
 * 否则用户开着编辑器时这些工具的数据就永远读不到。
 */
function withSnapshot(dbPath, run) {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-db-'));
  try {
    const copy = join(dir, basename(dbPath));
    copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      try {
        copyFileSync(dbPath + suffix, copy + suffix);
      } catch {
        // 这两个文件不一定存在
      }
    }
    return run(copy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function queryDbJson(dbPath, sql) {
  const attempt = (path) => {
    const native = queryNative(path, sql);
    if (native !== null) return native;
    return queryCli(path, sql);
  };

  try {
    return attempt(dbPath);
  } catch (err) {
    const message = String(err?.message ?? '');
    if (/database is locked|database table is locked/i.test(message)) {
      return withSnapshot(dbPath, attempt);
    }
    if (err?.code === 'ENOENT' && /sqlite3/.test(message)) {
      throw new Error('未找到 sqlite3 CLI。安装 sqlite3 或改用 Node ≥ 22.5 才能读取该工具的数据。');
    }
    throw err;
  }
}

/** SQLite 解析器共用：把一次性查询结果包装成标准 createFileParser 形态。 */
export function sqliteParser({ id, rowsToRecords, dbPaths }) {
  return {
    // 告诉 scan.js 不要把库文件当文本读，也不要尝试增量尾读。
    readMode: 'none',
    discover() {
      // SQLite 库不是逐行追加的日志，没有 offset 可言；每次全量重查。
      // 用 mtime 做签名仍然有效——库没变就复用缓存。
      return dbPaths().map(({ path, size, mtimeMs, ino, project }) => ({
        path, size, mtimeMs, ino, sessionId: path, fallbackProject: project ?? null,
      }));
    },
    createFileParser({ candidate }) {
      return {
        onObject() { /* 不走行解析 */ },
        finish() {
          try {
            return { records: rowsToRecords(candidate.path), state: null };
          } catch (err) {
            // 让 scan.js 记 warning 而不是整体失败
            throw new Error(`${id}: ${err.message}`);
          }
        },
      };
    },
  };
}
