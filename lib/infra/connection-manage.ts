import {connectionMethod} from "./connection-registry";
import { randomUUID } from "node:crypto";
import { mutateIntegrationState } from "./connection-storage";
import { createConnectionIn, summaryIn } from "./connection-service";
import { IntegrationError, identity, connectionLabel, canonicalFolder, selectConnection, metadataOnly, assertNotBusy, type ConnectionSource } from "./identity";
export const INTEGRATION_ACTIONS=["user.create","user.rename","user.duplicate","user.delete","user.default","folder.map","folder.unmap","connection.create","connection.rename","connection.default","connection.delete","credential.delete"] as const;
export async function integrationManage(input:Record<string,unknown>){
  metadataOnly(input);if(input.confirm!==true)throw new IntegrationError("confirmation_required",403);
  const shapes:Record<string,string[]>={
    "user.create":["user","label"],"user.rename":["user","target","label"],"user.duplicate":["user","target","label","copyCredentials"],"user.delete":["user"],"user.default":["user"],
    "folder.map":["user","path","provider","connection"],"folder.unmap":["path"],"connection.create":["user","provider","connection","label","source","authMethod","makeDefault"],
    "connection.rename":["user","provider","connection","label"],"connection.default":["user","provider","connection"],"connection.delete":["user","provider","connection"],"credential.delete":["user","provider","connection","key"],
  };
  const action=String(input.action);if(!shapes[action]||Object.keys(input).some(k=>!["action","confirm",...shapes[action]].includes(k)))throw new IntegrationError("invalid_management_fields");
  return mutateIntegrationState(state=>{
    if(action==="folder.unmap"){const p=canonicalFolder(String(input.path));state.bindings=state.bindings.filter(b=>b.path!==p);return{ok:true,action};}
    const user=identity(input.user,"user");
    if(action==="user.create"){
      if(Object.hasOwn(state.users,user))throw new IntegrationError("user_exists",409);
      state.users[user]={id:user,uid:randomUUID(),label:connectionLabel(input.label??user),connections:{},defaults:{}};if(!state.defaultUser)state.defaultUser=user;return{ok:true,action,user};
    }
    const profile=state.users[user];if(!profile)throw new IntegrationError("user_not_found",404);
    if(action==="user.default"){state.defaultUser=user;return{ok:true,action,user};}
    if(action==="user.delete"){
      Object.values(profile.connections).flatMap(Object.values).forEach(assertNotBusy);
      delete state.users[user];state.bindings=state.bindings.filter(b=>b.user!==user);if(state.defaultUser===user)state.defaultUser=null;return{ok:true,action,user};
    }
    if(action==="user.rename"||action==="user.duplicate"){
      const target=identity(input.target,"target");if(Object.hasOwn(state.users,target))throw new IntegrationError("user_exists",409);
      Object.values(profile.connections).flatMap(Object.values).forEach(assertNotBusy);
      const copy=structuredClone(profile);copy.id=target;if(action==="user.duplicate")copy.uid=randomUUID();copy.label=connectionLabel(input.label??target);
      for(const rows of Object.values(copy.connections))for(const c of Object.values(rows)){c.uid=randomUUID();c.revision++;c.updatedAt=Date.now();delete c.lease;if(action==="user.duplicate"&&input.copyCredentials!==true){c.values={};delete c.verifiedAt;}if(action==="user.duplicate"&&c.source!=="direct"){c.external=undefined;delete c.verifiedAt;}}
      state.users[target]=copy;
      if(action==="user.rename"){delete state.users[user];for(const b of state.bindings)if(b.user===user)b.user=target;if(state.defaultUser===user)state.defaultUser=target;}
      return{ok:true,action,user:target};
    }
    if(action==="folder.map"){
      const p=canonicalFolder(String(input.path)),old=state.bindings.find(b=>b.path===p),connections=old?.user===user?{...old.connections}:{};
      if(input.provider||input.connection){const provider=identity(input.provider,"provider"),connection=identity(input.connection,"connection");selectConnection(state,provider,{user,connection});connections[provider]=connection;}
      state.bindings=state.bindings.filter(b=>b.path!==p);state.bindings.push({path:p,user,connections});return{ok:true,action,user,path:p};
    }
    const provider=identity(input.provider,"provider"),connection=identity(input.connection,"connection");
    if(action==="connection.create"){const c=createConnectionIn(state,{user,provider,connection,label:input.label as string|undefined,source:input.source as ConnectionSource|undefined,authMethod:input.authMethod as string|undefined,makeDefault:input.makeDefault===true});return{ok:true,action,connection:summaryIn(state,user,c)};}
    const {connection:c}=selectConnection(state,provider,{user,connection});assertNotBusy(c);
    if(action==="connection.default")profile.defaults[provider]=connection;
    if(action==="connection.rename"){c.label=connectionLabel(input.label);c.updatedAt=Date.now();}
    if(action==="connection.delete"){
      if(state.bindings.some(b=>b.user===user&&b.connections[provider]===connection))throw new IntegrationError("connection_has_folder_binding",409);
      if(Object.values(profile.connections).some(rows=>Object.values(rows).some(x=>x.source==="composio"&&x.external?.brokerConnection===connection&&provider==="composio")))throw new IntegrationError("broker_has_linked_connections",409);
      delete profile.connections[provider][connection];if(profile.defaults[provider]===connection)delete profile.defaults[provider];return{ok:true,action,user,provider,connection};
    }
    if(action==="credential.delete"){
      if(c.source!=="direct")throw new IntegrationError("external_secrets_forbidden");
      if(input.key!==undefined){const key=identity(input.key,"key");if(!connectionMethod(provider,c.source,c.authMethod).fields.some(f=>f.key===key))throw new IntegrationError("unknown_credential_field");delete c.values[key];}else c.values={};c.revision++;delete c.verifiedAt;c.updatedAt=Date.now();
    }
    return{ok:true,action,connection:summaryIn(state,user,c)};
  });
}
