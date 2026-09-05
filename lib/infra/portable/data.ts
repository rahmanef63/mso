import {randomBytes,randomUUID} from 'node:crypto';
import * as codec from './codec.js';
import {FIELD_MAP,wireMethod,nativeMethod} from './mapping';
import {readIntegrationState,mutateIntegrationState} from '../connection-storage';
import {connectionMethod} from '../connection-registry';
import {IntegrationError,identity,type IntegrationState} from '../identity';
import {isInfraProviderId,normalizeInfraValues} from '../catalog';
export type TransferOptions={users?:string[];includeSecrets?:boolean;passphrase?:string;prefix?:string;policy?:'skip'|'error';apply?:boolean;confirm?:string;acceptWarnings?:boolean};
// Import previews use opaque, process-local one-time tokens. The snapshot contains
// the original document (encrypted when credentials are present), options and
// destination metadata — never a password/credential digest exposed to the caller.
const PLAN_TTL_MS=10*60*1000,MAX_PLANS=128;
const plans=new Map<string,{snapshot:string;expires:number}>();
function snapshot(document:unknown,options:TransferOptions,state:IntegrationState){return JSON.stringify([document,options.prefix??'',options.policy??'skip',state.users,state.defaultUser,state.bindings]);}
function issuePlan(value:string){const now=Date.now();for(const [id,p]of plans)if(p.expires<=now)plans.delete(id);while(plans.size>=MAX_PLANS)plans.delete(plans.keys().next().value!);const id=randomBytes(32).toString('hex');plans.set(id,{snapshot:value,expires:now+PLAN_TTL_MS});return id;}
function requirePlan(id:string|undefined,value:string){if(!id)throw new IntegrationError('preview_required_or_destination_changed',409);const p=plans.get(id);if(!p||p.expires<=Date.now()||p.snapshot!==value){plans.delete(id);throw new IntegrationError('preview_required_or_destination_changed',409)}return id;}
export async function exportIntegrationData(options:TransferOptions={}){
  const state=await readIntegrationState(),ids=options.users??Object.keys(state.users);
  if(!Array.isArray(ids)||ids.some(id=>!Object.hasOwn(state.users,identity(id))))throw new IntegrationError('unknown_export_user');
  const users=[...new Set(ids)].map(id=>({id,label:state.users[id].label,connections:Object.values(state.users[id].connections).flatMap(rows=>Object.values(rows)).map(c=>{
    const m=connectionMethod(c.provider,c.source,c.authMethod),map=FIELD_MAP[c.provider]??{},reverse=Object.fromEntries(Object.entries(map).map(([a,b])=>[b,a]));
    const fields=m.fields.map(f=>({key:reverse[f.key],secret:f.secret,configured:Boolean(c.values[f.key])}));
    if(fields.some(f=>!f.key))throw new IntegrationError('unmapped_export_field');
    return{id:c.id,label:c.label,provider:c.provider,source:c.source,authMethod:wireMethod(c.provider,c.source,c.authMethod),scope:c.scope,fields,...(options.includeSecrets&&c.source==='direct'?{values:Object.fromEntries(Object.entries(c.values).filter(([k])=>reverse[k]).map(([k,v])=>[reverse[k],v]))}:{})};
  })}));
  const payload=codec.payload({name:'mso',version:'1'},users,options.includeSecrets?'secrets':'metadata');
  return options.includeSecrets?codec.seal(payload,options.passphrase??''):payload;
}
function previewIn(bundle:codec.Bundle,options:TransferOptions,state:IntegrationState,planId:string){
  const prefix=options.prefix??'',policy=options.policy??'skip';
  if(!['skip','error'].includes(policy)||typeof prefix!=='string'||(prefix&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(prefix)))throw new IntegrationError('invalid_import_options');
  const users:Array<{id:string;label:string}>=[],rows:Array<Record<string,unknown>>=[],warnings:Array<Record<string,unknown>>=[],pending:Array<{user:string;c:codec.PortableConnection;method:ReturnType<typeof connectionMethod>;values:Record<string,string>}>=[];
  for(const u of bundle.users){const user=identity(prefix+u.id);if(!Object.hasOwn(state.users,user))users.push({id:user,label:u.label});
    for(const c of u.connections){const ref={user,provider:c.provider,connection:c.id,label:c.label};let method:ReturnType<typeof connectionMethod>|undefined,reason='';
      try{method=connectionMethod(c.provider,c.source,nativeMethod(c.provider,c.source,c.authMethod))}catch{reason='unsupported_provider_or_method'}
      const existing=state.users[user]?.connections[c.provider];
      if(!reason&&(existing?.[c.id]||Object.values(existing??{}).some(x=>x.label.toLowerCase()===c.label.toLowerCase())))reason='existing_connection_preserved';
      if(reason||!method){rows.push({...ref,status:'skip',reason});warnings.push({...ref,reason});continue;}
      const map=FIELD_MAP[c.provider]??{},allowed=new Set(method.fields.map(f=>f.key)),unmapped=c.fields.filter(f=>!map[f.key]||!allowed.has(map[f.key]));
      if(unmapped.length)warnings.push({...ref,reason:'unsupported_fields_omitted',fields:unmapped.map(f=>f.key)});
      if(c.source!=='direct')warnings.push({...ref,reason:'external_authorization_required'});
      let values=Object.fromEntries(Object.entries(c.values??{}).filter(([k])=>map[k]&&allowed.has(map[k])).map(([k,v])=>[map[k],v]));
      if(isInfraProviderId(c.provider)&&Object.keys(values).length)try{values=normalizeInfraValues(c.provider,values)}catch{throw new IntegrationError('invalid_imported_field_format')}
      rows.push({...ref,status:'create',source:c.source,authMethod:method.id,credentialFields:Object.keys(values).length});pending.push({user,c,method,values});
    }
  }
  return{preview:{planId,mode:bundle.mode,producer:bundle.producer.name,createUsers:users,connections:rows,warnings,canApply:policy!=='error'||!rows.some(r=>r.status==='skip'),requiresWarningAcceptance:warnings.length>0,defaultsChanged:false,folderBindingsImported:false,verified:false},pending};
}
export async function importIntegrationData(document:unknown,options:TransferOptions={}){
  const bundle=await codec.open(document,options.passphrase);
  if(!options.apply){const state=await readIntegrationState(),planId=issuePlan(snapshot(document,options,state));return previewIn(bundle,options,state,planId).preview;}
  return mutateIntegrationState(state=>{
    const value=snapshot(document,options,state),planId=requirePlan(options.confirm,value);
    const {preview,pending}=previewIn(bundle,options,state,planId);
    if(!preview.canApply)throw new IntegrationError('import_conflicts',409);
    if(preview.requiresWarningAcceptance&&options.acceptWarnings!==true)throw new IntegrationError('review_and_accept_import_warnings',409);
    plans.delete(planId);
    for(const u of preview.createUsers)state.users[u.id]={...u,uid:randomUUID(),connections:{},defaults:{}};
    for(const{user,c,method,values}of pending){const profile=state.users[user];profile.connections[c.provider]??={};
      profile.connections[c.provider][c.id]={id:c.id,uid:randomUUID(),label:c.label,provider:c.provider,source:c.source,authMethod:method.id,scope:method.scope,revision:1,values,createdAt:Date.now(),updatedAt:Date.now()};
    }
    return{...preview,applied:true,created:pending.length};
  });
}
