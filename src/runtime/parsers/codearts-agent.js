import { homedir } from 'node:os';
import { join, delimiter, basename } from 'node:path';
import { statSync } from 'node:fs';
import { databaseCandidate, timestamp } from './local-data.js';
import { queryDbJson } from './sqlite.js';
import { projectFromCwd } from './claude-code.js';
import { toCount, UNKNOWN_MODEL } from '../usage-record.js';

// Vibe b4a3874 / CodeArts Agent 26.9.101: independent OpenCode-derived store.
export const id='codearts-agent';
export const label='CodeArts Agent';
export const readMode='none';
export const lineFilter=null;
export const dataDirs=()=>process.env.MACLAWD_CODEARTS_AGENT_DIRS?.split(delimiter).filter(Boolean)
  || [join(homedir(),'.codeartsdoer/codearts-data')];
export function discover() {
  const files=new Map();
  for(const root of dataDirs()) {
    let isFile;
    try { isFile=statSync(root).isFile(); } catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const path of isFile?[root]:[join(root,'opencode.db'),join(root,'codearts-data/opencode.db')]) {
      if(basename(path)!=='opencode.db')continue;
      const file=databaseCandidate(path);if(file)files.set(file.path,file);
    }
  }
  return [...files.values()];
}
export function createFileParser({candidate}) {
  return {onObject(){},finish(){
    const sessions=new Map(queryDbJson(candidate.path,'SELECT id,parent_id,directory FROM session').map(s=>[s.id,s]));
    const rows=queryDbJson(candidate.path,`SELECT id,session_id,time_created,
      json_extract(data,'$.time.created') AS created,
      coalesce(json_extract(data,'$.modelID'),json_extract(data,'$.modelId'),json_extract(data,'$.model.modelID'),json_extract(data,'$.model.modelId')) AS model,
      coalesce(json_extract(data,'$.path.root'),json_extract(data,'$.path.cwd')) AS cwd,
      json_extract(data,'$.tokens.input') AS input,
      json_extract(data,'$.tokens.output') AS output,
      json_extract(data,'$.tokens.reasoning') AS reasoning,
      json_extract(data,'$.tokens.cache.read') AS cacheRead,
      json_extract(data,'$.tokens.cache.write') AS cacheWrite
      FROM message WHERE json_extract(data,'$.role')='assistant'`);
    const records=[];
    for(const row of rows){
      const input=toCount(row.input),reasoning=toCount(row.reasoning),output=toCount(row.output)+reasoning;
      const cacheRead=toCount(row.cacheRead),write5m=toCount(row.cacheWrite);
      if(!(input+output+cacheRead+write5m))continue;
      const ts=timestamp(row.created)??timestamp(row.time_created);
      if(ts===null)throw new Error('CodeArts Agent 用量时间格式不支持');
      let session=sessions.get(row.session_id);const visited=new Set();
      while(session?.parent_id && sessions.has(session.parent_id) && !visited.has(session.id)){
        visited.add(session.id);session=sessions.get(session.parent_id);
      }
      records.push({source:id,ts,input,output,reasoning,cacheRead,write5m,write1h:0,
        model:row.model||UNKNOWN_MODEL,cwd:row.cwd||session?.directory||null,
        project:projectFromCwd(row.cwd||session?.directory),
        billing:{promptTokens:input+cacheRead+write5m,unknownWriteTTL:write5m>0},
        messageId:JSON.stringify([row.session_id,row.id]),requestId:null,uuid:null,sidechain:false});
    }
    return {records,state:null};
  }};
}
