import { statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function applicationData(name) {
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, name);
}

/** Active SQLite writers often change only WAL, not the main database file. */
export function databaseCandidate(file) {
  try {
    const path = realpathSync(file), stat = statSync(path);
    let wal = '';
    try { const s = statSync(path + '-wal'); wal = `${s.ino}:${s.size}:${s.mtimeMs}`; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino,
      cacheKey: wal, sessionId: path, readMode: 'none' };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  const ts = Number.isFinite(n) ? n < 1e11 ? n * 1000 : n : Date.parse(value);
  return Number.isFinite(ts) && ts > 0 && ts < 1e14 ? ts : null;
}
