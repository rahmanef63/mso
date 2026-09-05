import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import * as codec from './codec.js';
import {FIELD_MAP,wireMethod,nativeMethod} from './mapping';
import {readIntegrationState,mutateIntegrationState} from '../connection-storage';
import {connectionMethod} from '../connection-registry';
import {IntegrationError,identity,type IntegrationState} from '../identity';
import {isInfraProviderId,normalizeInfraValues} from '../catalog';
export type TransferOptions={users?:string[];includeSecrets?:boolean;passphrase?:string;prefix?:string;policy?:'skip'|'error';apply?:boolean;confirm?:string;acceptWarnings?:boolean};
// Preview confirmation must bind the exact decrypted bundle without exposing an
// unkeyed digest of credential values as an offline guessing oracle. A process-local
// random key intentionally invalidates pending previews after a server restart.
const PLAN_KEY=randomBytes(32);
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
function previewIn(bundle:codec.Bundle,options:TransferOptions,state:IntegrationState){
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
  // Exclude random empty-store instance IDs; bind the preview to all persisted destination data.
  const planId=createHmac('sha256',PLAN_KEY).update(JSON.stringify([bundle,prefix,policy,state.users,state.defaultUser,state.bindings])).digest('hex');
  return{preview:{planId,mode:bundle.mode,producer:bundle.producer.name,createUsers:users,connections:rows,warnings,canApply:policy!=='error'||!rows.some(r=>r.status==='skip'),requiresWarningAcceptance:warnings.length>0,defaultsChanged:false,folderBindingsImported:false,verified:false},pending};
}
export async function importIntegrationData(document:unknown,options:TransferOptions={}){
  const bundle=await codec.open(document,options.passphrase);
  if(!options.apply)return previewIn(bundle,options,await readIntegrationState()).preview;
  return mutateIntegrationState(state=>{
    const {preview,pending}=previewIn(bundle,options,state);
    if(options.confirm!==preview.planId)throw new IntegrationError('preview_required_or_destination_changed',409);
    if(!preview.canApply)throw new IntegrationError('import_conflicts',409);
    if(preview.requiresWarningAcceptance&&options.acceptWarnings!==true)throw new IntegrationError('review_and_accept_import_warnings',409);
    for(const u of preview.createUsers)state.users[u.id]={...u,uid:randomUUID(),connections:{},defaults:{}};
    for(const{user,c,method,values}of pending){const profile=state.users[user];profile.connections[c.provider]??={};
      profile.connections[c.provider][c.id]={id:c.id,uid:randomUUID(),label:c.label,provider:c.provider,source:c.source,authMethod:method.id,scope:method.scope,revision:1,values,createdAt:Date.now(),updatedAt:Date.now()};
    }
    return{...preview,applied:true,created:pending.length};
  });
}
