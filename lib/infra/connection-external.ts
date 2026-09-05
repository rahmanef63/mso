import {randomUUID} from "node:crypto";
import { readIntegrationState, mutateIntegrationState } from "./connection-storage";
import { selectConnection, IntegrationError, assertNotBusy, type ConnectionSelector } from "./identity";
import { composioDefinition, nativeDefinition } from "./connection-registry";
import { summaryIn } from "./connection-service";
import { request, obj } from "./http";
const BASE="https://backend.composio.dev/api/v3.1";
async function api(key:string,endpoint:string,body?:unknown){
  let result;try{result=await request(BASE+endpoint,{method:body===undefined?"GET":"POST",headers:{"x-api-key":key,accept:"application/json","content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw new IntegrationError("composio_unreachable",502);}
  if(!result.ok)throw new IntegrationError(`composio_http_${result.status}`,502);return obj(result.body);
}
async function context(provider:string,selection:ConnectionSelector,brokerId?:string){
  if(!selection.user||!selection.connection)throw new IntegrationError("choose_user_and_connection",409);
  const d=await readIntegrationState(),r=selectConnection(d,provider,selection),c=r.connection;
  if(c.source!=="composio")throw new IntegrationError("composio_source_required");
  const broker=selectConnection(d,"composio",{user:r.user,connection:brokerId??c.external?.brokerConnection,source:"direct",authMethod:"project"}).connection;
  if(!broker.values.apiKey)throw new IntegrationError("composio_project_key_required",409);
  return{d,r,c,broker,definition:composioDefinition(provider)!};
}
async function authorizeUnlocked(provider:string,selection:ConnectionSelector,options:{authConfigId?:string;brokerConnection?:string;createManaged?:boolean}={}){
  const {r,c,broker,definition}=await context(provider,selection,options.brokerConnection);
  if(c.external?.connectedAccountId)throw new IntegrationError("already_linked_sync_first",409);
  const scheme=c.authMethod==="oauth2"?"OAUTH2":"API_KEY";let config:Record<string,unknown>;
  const configId=options.authConfigId??c.external?.authConfigId;
  if(configId){config=await api(broker.values.apiKey,`/auth_configs/${encodeURIComponent(configId)}`);}
  else{
    const result=await api(broker.values.apiKey,`/auth_configs?toolkit_slug=${encodeURIComponent(definition.toolkit)}&show_disabled=false&limit=50`);
    const rows=(Array.isArray(result.items)?result.items:[]).map(obj).filter(x=>obj(x.toolkit).slug===definition.toolkit&&(x.auth_scheme??obj(x.auth_config).auth_scheme)===scheme&&(!x.status||x.status==="ENABLED"));
    if(rows.length>1)throw new IntegrationError("choose_auth_config_id",409);
    if(rows.length)config=rows[0];
    else if(definition.managed&&options.createManaged){const result=await api(broker.values.apiKey,"/auth_configs",{toolkit:{slug:definition.toolkit}});config={...obj(result.auth_config),toolkit:result.toolkit};}
    else throw new IntegrationError("matching_auth_config_required",409);
  }
  const nested=obj(config.auth_config),actual=String(config.id??nested.id??""),toolkit=String(obj(config.toolkit).slug??"");
  if(!actual||toolkit!==definition.toolkit||(config.auth_scheme??nested.auth_scheme)!==scheme||(config.status&&config.status!=="ENABLED"))throw new IntegrationError("auth_config_mismatch",409);
  const namespace=await readIntegrationState();const remoteUserId=`mso:${namespace.instanceId}:${namespace.users[r.user].uid}`,linked=await api(broker.values.apiKey,"/connected_accounts/link",{auth_config_id:actual,user_id:remoteUserId,alias:c.uid});
  const id=linked.connected_account_id??linked.id;let url:URL;try{url=new URL(String(linked.redirect_url));}catch{throw new IntegrationError("invalid_authorization_link",502);}
  if(typeof id!=="string"||!id||url.protocol!=="https:"||url.username||url.password||!["connect.composio.dev","backend.composio.dev","platform.composio.dev"].includes(url.hostname))throw new IntegrationError("invalid_authorization_link",502);
  const safe=await mutateIntegrationState(d=>{const now=selectConnection(d,provider,selection).connection;if(now.uid!==c.uid||now.revision!==c.revision)throw new IntegrationError("connection_changed",409);now.external={connectedAccountId:id,authConfigId:actual,brokerConnection:broker.id,toolkit:definition.toolkit,remoteUserId,status:"INITIALIZING",checkedAt:Date.now()};now.revision++;return summaryIn(d,r.user,now);});
  // The route/tool adapter must put this link ONLY in a private UI response.
  return{connection:safe,privateUrl:url.href};
}
export async function verifyExternalIntegration(provider:string,selection:ConnectionSelector){
  const d=await readIntegrationState(),r=selectConnection(d,provider,selection);
  if(r.connection.source==="native-mcp")return{id:provider,ok:null,detail:"Authorize and verify through the provider-owned MCP client; no local credential fallback",user:r.user,connection:r.connection.id,endpoint:nativeDefinition(provider)?.url};
  const {c,broker,definition}=await context(provider,selection);const id=c.external?.connectedAccountId;
  if(!id)return{id:provider,ok:null,detail:"authorization required",user:r.user,connection:c.id};
  const raw=await api(broker.values.apiKey,`/connected_accounts/${encodeURIComponent(id)}`);
  if(raw.id!==id||obj(raw.toolkit).slug!==definition.toolkit||(c.external?.remoteUserId&&raw.user_id!==c.external.remoteUserId)||(c.external?.authConfigId&&obj(raw.auth_config).id!==c.external.authConfigId))throw new IntegrationError("connected_account_identity_mismatch",409);
  const state=typeof raw.status==="string"&&/^[A-Z_]{1,40}$/.test(raw.status)?raw.status:"UNKNOWN";
  await mutateIntegrationState(d=>{const now=selectConnection(d,provider,selection).connection;if(now.uid!==c.uid||now.revision!==c.revision)throw new IntegrationError("connection_changed",409);now.external={...now.external,status:state,checkedAt:Date.now()};});
  return{id:provider,ok:state==="ACTIVE",detail:state,user:r.user,connection:c.id};
}
async function executeUnlocked(provider:string,selection:ConnectionSelector,tool:string,args:Record<string,unknown>){
  const {c,broker,definition}=await context(provider,selection);
  if(c.external?.status!=="ACTIVE"||!c.external.connectedAccountId)throw new IntegrationError("active_connected_account_required",409);
  if(!/^[A-Z][A-Z0-9_]{2,180}$/.test(tool)||!tool.startsWith(definition.toolkit.toUpperCase()+"_"))throw new IntegrationError("toolkit_tool_mismatch");
  // Revalidate identity/status immediately before acting; never select another account implicitly.
  const verified=await verifyExternalIntegration(provider,selection);if(verified.ok!==true)throw new IntegrationError("active_connected_account_required",409);
  const result=await api(broker.values.apiKey,`/tools/execute/${encodeURIComponent(tool)}`,{connected_account_id:c.external.connectedAccountId,arguments:args});
  function redact(v:unknown,depth=0):unknown{if(depth>16)return"[depth limited]";if(typeof v==="string")return v.split(broker.values.apiKey).join("[redacted]");if(Array.isArray(v))return v.map(x=>redact(x,depth+1));if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/token|password|secret|api.?key|authorization|credential/i.test(k)?"[redacted]":redact(x,depth+1)]));return v;}
  return{user:selection.user,provider,connection:c.id,source:c.source,result:redact(result)};
}

async function leased<T>(provider:string,selection:ConnectionSelector,brokerId:string|undefined,fn:(brokerId:string)=>Promise<T>):Promise<T>{
  const ctx=await context(provider,selection,brokerId),lease={id:randomUUID(),until:Date.now()+120000};
  await mutateIntegrationState(d=>{for(const [p,id,expected] of [[provider,ctx.c.id,ctx.c],["composio",ctx.broker.id,ctx.broker]] as const){const c=selectConnection(d,p,{user:ctx.r.user,connection:id}).connection;assertNotBusy(c);if(c.uid!==expected.uid||c.revision!==expected.revision)throw new IntegrationError("connection_changed",409);c.lease=lease;}});
  try{return await fn(ctx.broker.id);}finally{await mutateIntegrationState(d=>{for(const rows of Object.values(d.users[ctx.r.user]?.connections??{}))for(const c of Object.values(rows))if(c.lease?.id===lease.id)delete c.lease;});}
}
export const authorizeIntegration=(provider:string,selection:ConnectionSelector,options:Parameters<typeof authorizeUnlocked>[2]={})=>leased(provider,selection,options?.brokerConnection,brokerId=>authorizeUnlocked(provider,selection,{...options,brokerConnection:brokerId}));
export const composioConnectionCall=(provider:string,selection:ConnectionSelector,tool:string,args:Record<string,unknown>)=>leased(provider,selection,undefined,()=>executeUnlocked(provider,selection,tool,args));
