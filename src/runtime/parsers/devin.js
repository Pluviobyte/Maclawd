import { homedir } from 'node:os';
import { join } from 'node:path';
import { databaseCandidate, timestamp } from './local-data.js';
import { queryDbJson } from './sqlite.js';
import { projectFromCwd } from './claude-code.js';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';

// Vibe b4a3874: Devin CLI and Desktop share this WAL store. Credit/ACU
// balances and chat content are deliberately absent from the query.
export const id = 'devin';
export const label = 'Devin';
export const readMode = 'none';
export const lineFilter = null;
export const dbPath = () => process.env.MACLAWD_DEVIN_DB || join(process.env.XDG_DATA_HOME || join(homedir(),'.local/share'),'devin/cli/sessions.db');
export const dataDirs = () => [dbPath()];
export const discover = () => { const file=databaseCandidate(dbPath());return file?[file]:[]; };
export function createFileParser({ candidate }) {
  return { onObject() {}, finish() {
    const rows=queryDbJson(candidate.path,`SELECT m.row_id AS rowId, m.session_id AS sessionId, m.created_at AS created,
      s.working_directory AS cwd, s.model AS sessionModel,
      json_extract(m.chat_message,'$.message_id') AS messageId,
      json_extract(m.chat_message,'$.metadata.created_at') AS timestamp,
      json_extract(m.chat_message,'$.metadata.generation_model') AS model,
      json_extract(m.chat_message,'$.metadata.metrics.input_tokens') AS input,
      json_extract(m.chat_message,'$.metadata.metrics.output_tokens') AS output,
      json_extract(m.chat_message,'$.metadata.metrics.cache_read_tokens') AS cacheRead,
      json_extract(m.chat_message,'$.metadata.metrics.cache_creation_tokens') AS cacheWrite
      FROM message_nodes m LEFT JOIN sessions s ON s.id=m.session_id
      WHERE json_extract(m.chat_message,'$.role')='assistant'`);
    const records=[];
    for(const row of rows) {
      const ts=timestamp(row.timestamp)??timestamp(row.created);
      const input=toCount(row.input),output=toCount(row.output),cacheRead=toCount(row.cacheRead),write5m=toCount(row.cacheWrite);
      if(!(input+output+cacheRead+write5m))continue;
      if(ts===null)throw new Error('Devin 用量时间格式不支持');
      records.push({source:id,ts,input,output,cacheRead,write5m,write1h:0,reasoning:0,
        model:row.model||row.sessionModel||UNKNOWN_MODEL,cwd:row.cwd,project:projectFromCwd(row.cwd),
        billing:{promptTokens:input+cacheRead+write5m,unknownWriteTTL:write5m>0},
        messageId:JSON.stringify([row.sessionId,row.messageId||`row:${row.rowId}`]),requestId:null,uuid:null,sidechain:false});
    }
    return {records,state:null};
  } };
}
