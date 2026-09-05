import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { connectionCatalog, connectionMethod, connectionSummary, nativeDefinition } from "./connection-registry";
import { readIntegrationState, mutateIntegrationState } from "./connection-storage";
import { IntegrationError, identity, connectionLabel, selectConnection, resolveUser, folderBinding, metadataOnly, assertNotBusy, type ConnectionSelector, type IntegrationState, type IntegrationConnection, type ConnectionSource } from "./identity";
import { normalizeInfraValues, isInfraProviderId } from "./catalog";
const CONTEXT=new AsyncLocalStorage<{selector:ConnectionSelector; pinned:Map<string,Record<string,string>>}>();
export function withIntegrationSelection<T>(selector:ConnectionSelector,fn:()=>T){return CONTEXT.run({selector,pinned:new Map()},fn);}
export function currentIntegrationSelection():ConnectionSelector{return CONTEXT.getStore()?.selector??{};}
export async function directConnectionValues(provider:string,selector:ConnectionSelector=currentIntegrationSelection()):Promise<Record<string,string>>{
  const context=CONTEXT.getStore(),cached=context?.selector===selector?context.pinned.get(provider):undefined;if(cached)return{...cached};
  const state=await readIntegrationState();if(!Object.keys(state.users).length&&!selector.user&&!selector.connection)return{};
  let result;try{result=selectConnection(state,provider,selector);}catch(e){if(e instanceof IntegrationError&&e.code==="connection_not_found"&&!selector.connection&&!folderBinding(state,selector.cwd)?.connections[provider]&&!state.users[resolveUser(state,selector)]?.defaults[provider])return{};throw e;}
  if(result.connection.source!=="direct")throw new IntegrationError("external_source_requires_own_executor",409);
  const copy={...result.connection.values};if(context&&context.selector===selector)context.pinned.set(provider,copy);return copy;
}
export function summaryIn(state:IntegrationState,user:string,c:IntegrationConnection){return connectionSummary(user,c,state.users[user].defaults[c.provider]===c.id);}
export async function resolveIntegration(provider:string,selector:ConnectionSelector={}){
  const state=await readIntegrationState(),resolved=selectConnection(state,provider,selector),c=resolved.connection;
  return{...summaryIn(state,resolved.user,c),resolution:resolved.reason,execution:c.source==="direct"?{route:"native-direct"}:c.source==="composio"?{route:"composio",connectedAccountId:c.external?.connectedAccountId??null,toolkit:c.external?.toolkit??null}:{route:"provider-mcp",endpoint:nativeDefinition(provider)?.url??null,authorization:"provider-client-owned"}};
}
export async function integrationSnapshot(selector:ConnectionSelector={}){
  const state=await readIntegrationState();let user:string|null=null;try{user=resolveUser(state,selector);}catch(e){if(selector.user)throw e;}
  const profiles=Object.values(state.users).map(u=>({id:u.id,label:u.label,isDefault:state.defaultUser===u.id,connectionCount:Object.values(u.connections).reduce((n,rows)=>n+Object.keys(rows).length,0)}));
  const connections=user?Object.values(state.users[user].connections).flatMap(rows=>Object.values(rows).map(c=>summaryIn(state,user!,c))):[];
  return{version:2,catalog:connectionCatalog(),users:profiles,user,bindings:state.bindings,connections,resolution:user?(selector.user?"explicit":folderBinding(state,selector.cwd)?"folder":"default"):"choose-user"};
}
export function createConnectionIn(state:IntegrationState,input:{user:string;provider:string;connection:string;label?:string;source?:ConnectionSource;authMethod?:string;makeDefault?:boolean}){
  const user=identity(input.user,"user"),provider=identity(input.provider,"provider"),id=identity(input.connection,"connection"),profile=state.users[user];if(!profile)throw new IntegrationError("user_not_found",404);
  const source=input.source??"direct",method=connectionMethod(provider,source,input.authMethod),rows=profile.connections[provider]??{};
  if(Object.hasOwn(rows,id))throw new IntegrationError("connection_exists",409);
  const c:IntegrationConnection={id,uid:randomUUID(),label:connectionLabel(input.label??id),provider,source,authMethod:method.id,scope:method.scope,revision:1,values:{},createdAt:Date.now(),updatedAt:Date.now()};
  profile.connections[provider]={...rows,[id]:c};if(input.makeDefault||!Object.keys(rows).length)profile.defaults[provider]=id;return c;
}
export async function credentialSnapshot(provider:string,selector:ConnectionSelector){
  const state=await readIntegrationState(),r=selectConnection(state,provider,selector);
  if(r.connection.source!=="direct")throw new IntegrationError("external_secrets_forbidden",409);
  return{user:r.user,connection:structuredClone(r.connection)};
}
export async function saveConnectionValues(provider:string,selector:ConnectionSelector,values:Record<string,unknown>,expected:{uid:string;revision:number},verified=true){
  return mutateIntegrationState(state=>{
    const r=selectConnection(state,provider,selector),c=r.connection;assertNotBusy(c);if(c.source!=="direct")throw new IntegrationError("external_secrets_forbidden",409);
    if(c.uid!==expected.uid||c.revision!==expected.revision)throw new IntegrationError("connection_changed_reopen_setup",409);
    if(!isInfraProviderId(provider))throw new IntegrationError("unknown_provider",404);
    const method=connectionMethod(provider,c.source,c.authMethod),allowed=new Set(method.fields.map(f=>f.key));
    if(Object.keys(values).some(k=>!allowed.has(k)))throw new IntegrationError("invalid_credential_fields");
    const normalized=normalizeInfraValues(provider,values),candidate={...c.values,...normalized};
    if(method.fields.some(f=>f.required&&!candidate[f.key]))throw new IntegrationError("required_fields_missing");
    c.values=candidate;c.revision++;c.updatedAt=Date.now();if(verified)c.verifiedAt=Date.now();else delete c.verifiedAt;
    return summaryIn(state,r.user,c);
  });
}
export async function integrationQuery(input:Record<string,unknown>){
  metadataOnly(input);const allowed=["view","user","provider","connection","cwd","source","authMethod"];
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw new IntegrationError("invalid_query_fields");
  const selection=input as ConnectionSelector,view=input.view??"snapshot";
  if(view==="catalog")return{catalog:connectionCatalog()};
  if(view==="resolve")return resolveIntegration(identity(input.provider,"provider"),selection);
  if(view==="request"){
    const provider=identity(input.provider,"provider");const catalog=connectionCatalog().find(p=>p.id===provider);if(!catalog)throw new IntegrationError("unknown_provider",404);
    if(!input.connection)return{provider,user:input.user??null,sources:catalog.sources,next:"choose named connection, source and auth; never pass keys through tool JSON"};
    const route=await resolveIntegration(provider,selection);return{...route,guidance:connectionMethod(provider,route.source,route.authMethod).guidance,next:route.source==="direct"?"integration_setup_open with this user and connection":route.source==="composio"?"authorize, then sync until ACTIVE":"authorize the provider-owned MCP in your client"};
  }
  if(!["snapshot","users","connections","which"].includes(String(view)))throw new IntegrationError("unknown_query_view");
  const out=await integrationSnapshot(selection);if(view==="users")return{users:out.users,user:out.user};if(view==="which")return{user:out.user,resolution:out.resolution,bindings:out.bindings};if(view==="connections")return{user:out.user,connections:out.connections.filter(c=>!input.provider||c.provider===input.provider)};return out;
}
