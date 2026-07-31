import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { usageDir, usagePath } from './paths.js';

/**
 * 本地 JSON 读写。写入走临时文件 + rename，避免进程在写一半时被杀导致文件损坏。
 *
 * 所有派生数据（解析缓存、tail 游标）损坏时都当空处理并重建，不向上抛错——
 * 它们随时可删是设计原则（token-tracking.md 原则 5）。
 */

export function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(usagePath(name), 'utf-8'));
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  mkdirSync(usageDir(), { recursive: true });
  const target = usagePath(name);
  const temp = join(usageDir(), `.${name}.${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(value), 'utf-8');
  renameSync(temp, target);
}

export function removeJson(name) {
  try {
    unlinkSync(usagePath(name));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
