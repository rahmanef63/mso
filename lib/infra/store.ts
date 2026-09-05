import {randomUUID} from "node:crypto";
import { getInfraProviderDefinition, normalizeInfraValues } from "./catalog";
import { mutateIntegrationState } from "./connection-storage";
import { currentIntegrationSelection, directConnectionValues, createConnectionIn } from "./connection-service";
import { legacyMethod, connectionMethod } from "./connection-registry";
import { selectConnection, IntegrationError, assertNotBusy } from "./identity";
import type { InfraProviderId, InfraProviderSummary, InfraProviderValues } from "./types";
export { INFRA_STORE_PATH } from "./connection-storage";
const mask=(value:string)=>value?"configured":"";
export const readInfraProvider=(id:InfraProviderId)=>directConnectionValues(id);
export async function setInfraProvider(id:InfraProviderId,raw:Record<string,unknown>):Promise<InfraProviderValues>{
  return mutateIntegrationState(state=>{
    const selector=currentIntegrationSelection();
    if(!Object.keys(state.users).length&&!selector.user){state.users.legacy={id:"legacy",uid:randomUUID(),label:"Existing MSO credentials",defaults:{},connections:{}};state.defaultUser="legacy";}
    let selected;
    try{selected=selectConnection(state,id,selector);}catch(e){
      if(!(e instanceof IntegrationError)||e.code!=="connection_not_found"||selector.connection)throw e;
      const user=selector.user??state.defaultUser;if(!user)throw new IntegrationError("user_required");
      const c=createConnectionIn(state,{user,provider:id,connection:"default",authMethod:legacyMethod(id,raw as Record<string,string>),makeDefault:true});selected={user,connection:c};
    }
    const c=selected.connection;assertNotBusy(c);if(c.source!=="direct")throw new IntegrationError("external_secrets_forbidden");
    const method=connectionMethod(id,c.source,c.authMethod),normalized=normalizeInfraValues(id,raw);
    if(Object.keys(normalized).some(k=>!method.fields.some(f=>f.key===k)))throw new IntegrationError("connection_auth_mismatch",409);
    const values={...c.values,...normalized};if(method.fields.some(f=>f.required&&!values[f.key]))throw new IntegrationError("required_fields_missing");
    c.values=values;c.revision++;c.updatedAt=Date.now();delete c.verifiedAt;return{...values};
  });
}
export async function removeInfraProvider(id:InfraProviderId){
  await mutateIntegrationState(state=>{const selection=currentIntegrationSelection();const r=selectConnection(state,id,selection);assertNotBusy(r.connection);if(state.bindings.some(b=>b.user===r.user&&b.connections[id]===r.connection.id))throw new IntegrationError("connection_has_folder_binding");if(id==="composio"&&Object.values(state.users[r.user].connections).some(rows=>Object.values(rows).some(c=>c.source==="composio"&&c.external?.brokerConnection===r.connection.id)))throw new IntegrationError("broker_has_linked_connections",409);const profile=state.users[r.user];
    const remaining=Object.fromEntries(Object.entries(profile.connections[id]).filter(([key])=>key!==r.connection.id));
    profile.connections=Object.fromEntries(Object.entries(profile.connections).map(([key,rows])=>[key,key===id?remaining:rows]));
    profile.defaults=Object.fromEntries(Object.entries(profile.defaults).filter(([key,value])=>key!==id||value!==r.connection.id));});
}
export function summarizeInfraProvider(id: InfraProviderId, values: InfraProviderValues): InfraProviderSummary {
  const def = getInfraProviderDefinition(id);
  const missing = def.fields.filter((field) => field.required && !values[field.key]).map((field) => field.key);
  if (id === "composio" && !values.apiKey && !values.orgApiKey) missing.push("project or organization API key");
  if (id === "hostinger" && !values.apiToken && !(values.mailApiToken && values.mailOrderId)) missing.push("account token or scoped Mail API token + order ID");
    if (id === "convex-cloud" && !values.personalToken && !(values.deployKey && values.deploymentName)) missing.push("personal token or deployment key and name");
  const safeValues = Object.fromEntries(def.fields
    .filter((field) => values[field.key])
    .map((field) => [field.key, field.secret ? mask(values[field.key]) : values[field.key]]));
  return { id, title: def.title, description: def.description, feature: def.feature, configured: missing.length === 0, missing, values: safeValues, fields: def.fields };
}
