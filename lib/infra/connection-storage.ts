import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { connectionMethod, legacyMethod } from "./connection-registry";
import { isInfraProviderId } from "./catalog";
import { emptyIntegrationState, IntegrationError, identity, type IntegrationState, type IntegrationConnection } from "./identity";
export const INFRA_STORE_PATH=expandOwnerStorePath(process.env.OS_INFRA_STORE??path.join(os.homedir(),".mso","private","infra-providers.json"));
const MAX=1024*1024;
async function readRaw():Promise<{raw:Record<string,unknown>;bytes:string}|null>{
  let handle;
  try{handle=await fs.open(INFRA_STORE_PATH,constants.O_RDONLY|constants.O_NOFOLLOW);const s=await handle.stat();
    if(!s.isFile()||s.size<1||s.size>MAX||(s.mode&0o077)||(typeof process.getuid==="function"&&s.uid!==process.getuid()))throw new IntegrationError("unsafe_integration_store");
    const bytes=await handle.readFile("utf8"),raw=JSON.parse(bytes);if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new IntegrationError("invalid_integration_store");return{raw,bytes};
  }catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw new IntegrationError("invalid_or_unsafe_integration_store");}finally{await handle?.close();}
}
function validate(d:IntegrationState):IntegrationState{
  if(d.version!==2||!d.instanceId||!d.users||typeof d.users!=="object"||Array.isArray(d.users)||!Array.isArray(d.bindings))throw new IntegrationError("invalid_integration_store");
  for(const [id,u] of Object.entries(d.users)){identity(id);if(u.id!==id||!u.connections||!u.defaults)throw new IntegrationError("invalid_integration_store");
    for(const [p,rows]of Object.entries(u.connections)){identity(p);for(const [cid,c]of Object.entries(rows)){identity(cid);if(c.id!==cid||c.provider!==p||!c.uid||!Number.isInteger(c.revision)||!c.values||typeof c.values!=="object"||Array.isArray(c.values)||Object.values(c.values).some(v=>typeof v!=="string"))throw new IntegrationError("invalid_connection_store");connectionMethod(c.provider,c.source,c.authMethod);if(c.source!=="direct"&&Object.keys(c.values).length)throw new IntegrationError("external_secrets_forbidden");}}
  }
  return d;
}
function projected(raw:Record<string,unknown>|undefined):IntegrationState{
  if(!raw)return emptyIntegrationState();if(raw.version===2)return validate(raw as unknown as IntegrationState);
  if(raw.version!==undefined)throw new IntegrationError("unsupported_store_version");
  const d=emptyIntegrationState(),providers=raw.providers;
  if(providers===undefined)return d;if(!providers||typeof providers!=="object"||Array.isArray(providers))throw new IntegrationError("invalid_legacy_store");
  const profile={id:"legacy",uid:"legacy",label:"Existing MSO credentials",defaults:{} as Record<string,string>,connections:{} as Record<string,Record<string,IntegrationConnection>>};
  for(const [provider,v] of Object.entries(providers)){
    if(!isInfraProviderId(provider)||!v||typeof v!=="object"||Array.isArray(v)||Object.values(v).some(x=>typeof x!=="string"))throw new IntegrationError("legacy_migration_requires_review");
    const values=v as Record<string,string>;const selected=legacyMethod(provider,values);
    const methods=provider==="composio"?[...(values.apiKey?["project"]:[]),...(values.orgApiKey?["organization"]:[])]:provider==="convex-cloud"?[...(values.personalToken?["personal"]:[]),...(values.deployKey||values.deploymentName?["deployment"]:[])]:["direct"];
    if(!methods.length)methods.push(selected);
    profile.connections[provider]={};
    for(const method of methods){const def=connectionMethod(provider,"direct",method),id=methods.length===1?"default":method;
      profile.connections[provider][id]={id,uid:`legacy:${provider}:${method}`,label:methods.length===1?"Existing connection":def.label,provider,source:"direct",authMethod:method,scope:def.scope,revision:1,values:Object.fromEntries(def.fields.filter(f=>values[f.key]!==undefined).map(f=>[f.key,values[f.key]])),createdAt:0,updatedAt:0};
      if(method===selected)profile.defaults[provider]=id;
    }
  }
  d.users.legacy=profile;d.defaultUser="legacy";return d;
}
async function write(d:IntegrationState){
  validate(d);const dir=path.dirname(INFRA_STORE_PATH);await fs.mkdir(dir,{recursive:true,mode:0o700});const st=await fs.lstat(dir);if(st.isSymbolicLink()||!st.isDirectory())throw new IntegrationError("unsafe_integration_directory");await fs.chmod(dir,0o700);
  const text=JSON.stringify(d,null,2);if(Buffer.byteLength(text)>MAX)throw new IntegrationError("integration_store_capacity",409);
  const temp=`${INFRA_STORE_PATH}.${randomUUID()}.tmp`;try{await fs.writeFile(temp,text,{mode:0o600,flag:"wx"});await fs.rename(temp,INFRA_STORE_PATH);}finally{await fs.unlink(temp).catch(()=>{});}
}
export async function readIntegrationState(){return projected((await readRaw())?.raw);}
export async function mutateIntegrationState<T>(fn:(d:IntegrationState)=>T|Promise<T>):Promise<T>{
  return withSecurityStoreLock(INFRA_STORE_PATH,async()=>{const previous=await readRaw(),d=projected(previous?.raw);const out=await fn(d);
    if(previous&&previous.raw.version!==2){
      const backup=`${INFRA_STORE_PATH}.v1-backup.json`;let h;try{h=await fs.open(backup,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(previous.bytes);}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;const existing=await fs.open(backup,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const stat=await existing.stat();if(!stat.isFile()||stat.size>MAX||(stat.mode&0o077)||stat.uid!==process.getuid?.()||(await existing.readFile("utf8"))!==previous.bytes)throw new IntegrationError("migration_backup_conflict",409);}finally{await existing.close();}}finally{await h?.close();}d.migratedAt=Date.now();
    }
    await write(d);return out;
  });
}
export async function migrateIntegrationStore(){await mutateIntegrationState(()=>null);return{ok:true,version:2,backupPreserved:true};}
