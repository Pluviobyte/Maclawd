/** Supported quota capability is independent of whether a first request succeeded. */
export const QUOTA_PROVIDERS = [
  ['claude-code','Claude','claude'],['codex','Codex','codex'],['grok','Grok Build','grok'],
  ['cursor','Cursor','cursor'],['workbuddy','WorkBuddy（国内版）','workBuddy'],
  ['workbuddy-ai','WorkBuddy AI（海外版）','workBuddyAI'],['kimi','Kimi','kimi'],
  ['kimi-code','Kimi Code CLI','kimiCode'],['doubao-work','豆包工作','doubaoWork'],
];
export const QUOTA_SOURCE_IDS = new Set(QUOTA_PROVIDERS.map(([id])=>id));
export function discoverQuotaSources(snapshot,{agents=[],statuses={},enabled=true}={}) {
  const sources=new Map((snapshot.sources??[]).map(s=>[s.id,{...s}]));
  for(const [id,label,key] of QUOTA_PROVIDERS) {
    const status=statuses[key]??{};
    const installed=agents.some(a=>a.id===id && a.installed && a.capabilities?.quota) || status.installed===true;
    if(!installed && !sources.has(id))continue;
    const source=sources.get(id)??{id,label,windows:[],context:null,model:null,lastSeenAt:null};
    const hasData=source.windows.length>0;
    let state='pending',message='已检测到工具，等待首次额度数据';
    if(!enabled || status.enabled===false){state='disabled';message='额度读取未开启，可在设置中启用';}
    else if(status.lastError){
      const code=String(status.lastError.code??'');
      state=/AUTH|LOGIN|CREDENTIAL|NOTCONFIGURED|TOKEN|SESSION/.test(code)?'needs-login':'error';
      message=state==='needs-login'?'请先在此工具中登录；登录后会自动重试':hasData?'本次读取失败，保留上次额度':'暂时无法读取额度，将自动重试';
    }else if(hasData){state='ready';message=null;}
    else if(status.refreshing){state='loading';message='正在读取额度…';}
    sources.set(id,{...source,detected:installed,availability:state,statusMessage:message});
  }
  return {...snapshot,sources:[...sources.values()],empty:sources.size===0};
}
/** New installed usage sources appear before their first record, while recorded variants keep their identities. */
export function discoverUsageSources(existing=[],agents=[]) {
  const ids=new Set(existing);
  for(const a of agents) if(a.installed && a.capabilities?.usage && ![...ids].some(id=>id===a.id||id.startsWith(a.id+':')))ids.add(a.id);
  return [...ids].sort();
}
