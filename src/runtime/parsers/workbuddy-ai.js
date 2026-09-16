import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as domestic from './workbuddy.js';
import { statelessParser } from '../parser-kit.js';

export const id = 'workbuddy-ai';
export const label = 'WorkBuddy AI（海外版）';
export const lineFilter = domestic.lineFilter;
export function projectsDir() {
  return process.env.MACLAWD_WORKBUDDY_AI_DIR?.trim() || join(homedir(), '.workbuddy-ai', 'projects');
}
export const dataDirs = () => process.env.MACLAWD_WORKBUDDY_AI_DIR?.trim() ? [projectsDir()] : [dirname(projectsDir())];
export const roots = () => [projectsDir()];
export const discover = (context) => domestic.discover(context, roots());
export function parseObject(value) {
  const record = domestic.parseObject(value);
  return record ? { ...record, source: id } : null;
}
export const createFileParser = statelessParser(parseObject);
