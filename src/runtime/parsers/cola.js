import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseObject as parsePi } from './pi-coding-agent.js';

export const id = 'cola';
export const label = 'Cola';
export const lineFilter = null;
const root = () => process.env.COLA_DATA_DIR?.trim() || join(homedir(), '.cola');
export const dataDirs = () => [root()];
export const keepSegments = true;
export function discover({ listJsonl }) {
  return listJsonl(join(root(), 'sessions')).map(file => ({ ...file, sessionId: file.path }));
}
export function createFileParser({ state, candidate } = {}) {
  const records = [];
  let header = state?.header ?? {};
  return {
    onObject(obj) {
      if (obj?.type === 'session') {
        header = { cwd: typeof obj.cwd === 'string' ? obj.cwd : null, id: obj.id, timestamp: obj.timestamp };
        return;
      }
      const r = parsePi(obj);
      if (!r) return;
      r.source = id; r.cwd = header.cwd;
      r.project = header.cwd ? basename(header.cwd) : null;
      // Copies retain entry identity; short ids alone collide across unrelated sessions.
      r.messageId = obj.id ? JSON.stringify([obj.id, r.ts, obj.parentId ?? null, 'assistant', r.model]) : null;
      r.billing.copyOwner = [header.timestamp ?? '', header.id ?? candidate?.path ?? ''];
      records.push(r);
    },
    finish: () => ({ records, state: { header } }),
  };
}
