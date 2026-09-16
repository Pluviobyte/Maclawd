import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { applicationData, databaseCandidate, timestamp } from './local-data.js';
import { queryDbJson } from './sqlite.js';
import { parseObject as parseClaude } from './claude-code.js';
import { toCount, throughput, UNKNOWN_MODEL } from '../usage-record.js';

// Contract independently checked against Vibe fcf1c398 and agent-trail 6e53f21f.
export function qoderParser({ id, label, name, env, cli }) {
  const roots = () => ({
    cli: process.env[`${env}_CONFIG_DIR`]?.trim() || join(homedir(), cli),
    ide: process.env[id === 'qoder-cn' ? 'QODER_CN_HOME' : 'QODER_HOME']?.trim()
      || join(applicationData(name), 'SharedClientCache'),
  });
  const modelName = value => {
    const model = typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN_MODEL;
    return /^(auto|ultimate|performance|efficient|lite)$/i.test(model) ? `qoder-${model.toLowerCase()}` : model;
  };
  return {
    id, label, lineFilter: null,
    dataDirs: () => Object.values(roots()),
    discover({ listJsonl }) {
      const root = roots();
      const db = databaseCandidate(join(root.ide, 'cache/db/local.db'));
      return [...listJsonl(join(root.cli, 'projects')).map(file => ({ ...file,
        sessionId: basename(file.path, '.jsonl'), fallbackProject: null })), ...(db ? [db] : [])];
    },
    createFileParser({ candidate, state } = {}) {
      const records = [];
      let session = state?.session ?? candidate?.sessionId, cwd = state?.cwd ?? null;
      return {
        onObject(obj) {
          if (typeof obj?.sessionId === 'string') session = obj.sessionId;
          if (typeof obj?.cwd === 'string') cwd = obj.cwd;
          const r = parseClaude(obj);
          if (!r || !throughput(r)) return; // credits are not tokens
          r.source = id; r.model = modelName(r.model); r.cwd ??= cwd;
          const identity = r.messageId || r.uuid;
          r.messageId = identity ? JSON.stringify([session, identity]) : null;
          r.uuid = null; r.requestId = null; r.sidechain = false;
          records.push(r);
        },
        finish() {
          if (candidate?.readMode === 'none') {
            const rows = queryDbJson(candidate.path,
              "SELECT id,session_id,gmt_create,token_info,model_info FROM chat_message WHERE role = 'assistant' AND token_info IS NOT NULL AND TRIM(token_info) <> ''");
            for (const row of rows) {
              const usage = JSON.parse(row.token_info), model = row.model_info ? JSON.parse(row.model_info) : {};
              if (!usage || typeof usage !== 'object') throw new Error('Qoder token_info 格式不受支持');
              for (const field of ['prompt_tokens', 'completion_tokens', 'cached_tokens']) {
                if (usage[field] != null && (!Number.isSafeInteger(Number(usage[field])) || Number(usage[field]) < 0)) {
                  throw new Error('Qoder Token 计数字段无效');
                }
              }
              const ts = timestamp(row.gmt_create);
              if (ts === null) throw new Error('Qoder 用量时间无效');
              const prompt = toCount(usage.prompt_tokens), output = toCount(usage.completion_tokens);
              const cacheRead = Math.min(prompt, toCount(usage.cached_tokens));
              if (!prompt && !output) continue;
              records.push({ source: id, model: modelName(model.model_key ?? model.modelKey), ts,
                input: prompt - cacheRead, cacheRead, output, write5m: 0, write1h: 0, reasoning: 0,
                billing: { promptTokens: prompt },
                messageId: JSON.stringify([candidate.path, row.id]), requestId: null, uuid: null, sidechain: false });
            }
          }
          return { records, state: { session, cwd } };
        },
      };
    },
  };
}
const parser = qoderParser({ id: 'qoder', label: 'Qoder（海外版）', name: 'Qoder', env: 'QODER', cli: '.qoder' });
export const { id, label, lineFilter, dataDirs, discover, createFileParser } = parser;
