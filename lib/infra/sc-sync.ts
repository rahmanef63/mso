/** Owner-local SC import. Values stay in process memory and the locked native store. */
import { randomUUID } from 'node:crypto';
import { connectionMethod } from './connection-registry';
import { FIELD_MAP, nativeMethod } from './portable/mapping';
import { normalizeInfraValues, isInfraProviderId } from './catalog';
import { assertNotBusy, identity, connectionLabel, IntegrationError, resolveSharedConnection, type IntegrationState, type IntegrationConnection } from './identity';
export type ScRow={user:string;provider:string;id:string;label:string;source:string;authMethod:string;isDefault?:boolean;values:Record<string,string>;sharedFrom?:{user:string;provider:string;connection:string}|null};
export type ScInput={users:Array<{id:string;label:string}>;rows:ScRow[]};
const ref=(u:string,p:string,c:string)=>`${u}/${p}/${c}`;
function mapped(row:ScRow){
  const source=row.source==='sc'?'direct':row.source;
  if(source!=='direct')throw new IntegrationError('sc_sync_external_requires_reauthorization');
  const method=connectionMethod(row.provider,source,row.provider==='doku'&&row.authMethod==='checkout-rest'?'payment':nativeMethod(row.provider,source,row.authMethod));
  const map={...FIELD_MAP[row.provider]};
  if(row.provider==='doku'&&method.id==='mcp')map.DOKU_CLIENT_ID='mcpClientId';
  const allowed=new Set(method.fields.map(f=>f.key)),values:Record<string,string>={};
  for(const [k,v]of Object.entries(row.values)){
    if(!map[k]||!allowed.has(map[k]))throw new IntegrationError('sc_sync_unmapped_field');
    values[map[k]]=v;
  }
  if(!isInfraProviderId(row.provider))throw new IntegrationError('sc_sync_unsupported_provider');
  return{source,method,values:normalizeInfraValues(row.provider,values)};
}
function compatible(c:IntegrationConnection,method:string,values:Record<string,string>){return c.source==='direct'&&c.authMethod===method&&!c.sharedFrom&&Object.entries(c.values).every(([k,v])=>values[k]===v);}
/** Mutates only the supplied transaction draft. Never returns values or their digests. */
export function syncScIn(state:IntegrationState,input:ScInput){
  const results:Array<{user:string;provider:string;sourceConnection:string;connection:string;action:string}>=[],targets=new Map<string,string>();
  for(const u of input.users){identity(u.id);connectionLabel(u.label);state.users[u.id]??={id:u.id,uid:randomUUID(),label:u.label,connections:{},defaults:{}};}
  const rows=input.rows.map(row=>{identity(row.user);identity(row.provider);identity(row.id);connectionLabel(row.label);if(!state.users[row.user])throw new IntegrationError('sc_sync_unknown_user');return{row,...mapped(row)};});
  for(const {row,method,values}of rows){
    const profile=state.users[row.user],group=profile.connections[row.provider]??={},key=ref(row.user,row.provider,row.id);
    let id=row.id,c=group[id];
    const match=(candidate:IntegrationConnection)=>row.sharedFrom?candidate.source==='direct'&&candidate.authMethod===method.id&&(Boolean(candidate.sharedFrom)||!Object.keys(candidate.values).length):compatible(candidate,method.id,values);
    if(c&&!match(c)){id=identity(`sc-${row.id}`);c=group[id];if(c&&!match(c))throw new IntegrationError('sc_sync_conflicting_alias');}
    targets.set(key,id);
    const created=!c;
    if(!c){c={id,uid:randomUUID(),label:id===row.id?row.label:connectionLabel(`SC: ${row.label}`),provider:row.provider,source:'direct',authMethod:method.id,scope:method.scope,revision:1,values:{},createdAt:Date.now(),updatedAt:Date.now()};group[id]=c;}
    const changed=!row.sharedFrom&&Object.entries(values).some(([k,v])=>c.values[k]!==v);
    if(changed){assertNotBusy(c);c.values={...values};c.revision++;c.updatedAt=Date.now();delete c.verifiedAt;delete c.lastCheck;}
    if(row.isDefault&&!profile.defaults[row.provider])profile.defaults[row.provider]=id;
    results.push({user:row.user,provider:row.provider,sourceConnection:row.id,connection:id,action:created?'created':changed?'filled':'unchanged'});
  }
  for(const {row,method}of rows)if(row.sharedFrom){
    const backing=row.sharedFrom,target=targets.get(ref(backing.user,backing.provider,backing.connection));
    if(backing.provider!==row.provider||!target)throw new IntegrationError('sc_sync_missing_shared_backing');
    const c=state.users[row.user].connections[row.provider][targets.get(ref(row.user,row.provider,row.id))!];
    const sharedFrom={user:backing.user,provider:backing.provider,connection:target};
    if(c.sharedFrom&&JSON.stringify(c.sharedFrom)!==JSON.stringify(sharedFrom))throw new IntegrationError('sc_sync_shared_conflict');
    if(!c.sharedFrom){assertNotBusy(c);c.sharedFrom=sharedFrom;c.revision++;delete c.verifiedAt;delete c.lastCheck;}
    if(resolveSharedConnection(state,row.user,c).connection.authMethod!==method.id)throw new IntegrationError('sc_sync_shared_method_mismatch');
  }
  for(const {row,values}of rows){const c=state.users[row.user].connections[row.provider][targets.get(ref(row.user,row.provider,row.id))!],actual=resolveSharedConnection(state,row.user,c).connection.values;if(Object.entries(values).some(([k,v])=>actual[k]!==v))throw new IntegrationError('sc_sync_parity_failed');}
  return{users:input.users.length,connections:rows.length,results,verifiedWithProvider:false};
}
