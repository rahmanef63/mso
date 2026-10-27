import { clearGoogleRuntime } from "./google-native-state";
import { assertNoVariableReferences } from "./connection-variables";
import {randomUUID} from "node:crypto";
import { getInfraProviderDefinition, canonicalProviderId, convexDeploymentKind, normalizeInfraValues, resolveProviderId } from "./catalog";
import { CONVEX_LEGACY_PROVIDER_ID } from "./types";
import { mutateIntegrationState } from "./connection-storage";
import { currentIntegrationSelection, directConnectionValues, createConnectionIn } from "./connection-service";
import { legacyMethod, connectionMethod } from "./connection-registry";
import { selectConnection, IntegrationError, assertNotBusy } from "./identity";
import type { InfraProviderId, InfraProviderRef, InfraProviderSummary, InfraProviderValues } from "./types";
export { INFRA_STORE_PATH } from "./connection-storage";
const mask=(value:string)=>value?"configured":"";
/**
 * Read a provider's values. `convex-cloud` is a READ ALIAS for `convex`: a row
 * written before the collapse may still live under the retired key, so a
 * `connection_not_found` on the canonical id retries the legacy key. Any other
 * error propagates unchanged — the alias never hides a real failure.
 */
export const readInfraProvider=async(id:InfraProviderId|string):Promise<InfraProviderValues>=>{
  const canonical=canonicalProviderId(id);
  try{return await directConnectionValues(canonical);}catch(error){
    if(canonical===id||!(error instanceof IntegrationError)||error.code!=="connection_not_found")throw error;
    return directConnectionValues(id);
  }
};
export async function setInfraProvider(id:InfraProviderRef,raw:Record<string,unknown>):Promise<InfraProviderValues>{
  return mutateIntegrationState(state=>{
    const provider=resolveProviderId(id);if(!provider)throw new IntegrationError("unknown_provider",404);
    const selector=currentIntegrationSelection();
    if(!Object.keys(state.users).length&&!selector.user){state.users.legacy={id:"legacy",uid:randomUUID(),label:"Existing MSO credentials",defaults:{},connections:{}};state.defaultUser="legacy";}
    // A row written before the collapse may still live under the retired key.
    // Resolve it there instead of creating a duplicate "default" connection.
    const legacyKey = provider === "convex" ? CONVEX_LEGACY_PROVIDER_ID : null;
    const pick = () => {
      try { return selectConnection(state,provider,selector); }
      catch (error) {
        if (!legacyKey || !(error instanceof IntegrationError) || error.code !== "connection_not_found") throw error;
        return selectConnection(state,legacyKey,selector);
      }
    };
    let selected;
    try{selected=pick();}catch(e){
      if(!(e instanceof IntegrationError)||e.code!=="connection_not_found"||selector.connection)throw e;
      const user=selector.user??state.defaultUser;if(!user)throw new IntegrationError("user_required");
      const c=createConnectionIn(state,{user,provider,connection:"default",authMethod:legacyMethod(provider,raw as Record<string,string>),makeDefault:true});selected={user,connection:c};
    }
    const c=selected.connection;assertNotBusy(c);if(c.source!=="direct")throw new IntegrationError("external_secrets_forbidden");
    const method=connectionMethod(provider,c.source,c.authMethod),normalized=normalizeInfraValues(provider,raw);
    // `deploymentKind` is a non-secret routing fact, not a method credential, so it
    // is never part of the method's credential field set.
    if(Object.keys(normalized).some(k=>k!=="deploymentKind"&&!method.fields.some(f=>f.key===k)))throw new IntegrationError("connection_auth_mismatch",409);
    // Persist the non-secret deployment kind on the Convex write path. It is
    // DERIVED from the credential shape the operator just supplied, so an old row
    // that never had it gains the field on its next rotation — and a row that
    // already has it keeps behaving identically. Never a credential value.
    if(provider==="convex")normalized.deploymentKind=convexDeploymentKind(normalized);
    const values={...c.values,...normalized};if(method.fields.some(f=>f.required&&!values[f.key]))throw new IntegrationError("required_fields_missing");
    clearGoogleRuntime(c);c.values=values;c.revision++;c.updatedAt=Date.now();delete c.verifiedAt;return{...values};
  });
}
export async function removeInfraProvider(id:InfraProviderRef){
  const provider=resolveProviderId(id);if(!provider)throw new IntegrationError("unknown_provider",404);
  await mutateIntegrationState(state=>{const selection=currentIntegrationSelection();const r=selectConnection(state,provider,selection);assertNotBusy(r.connection);assertNoVariableReferences(state,r.user,provider,r.connection.id);if(state.bindings.some(b=>b.user===r.user&&b.connections[provider]===r.connection.id))throw new IntegrationError("connection_has_folder_binding");if(provider==="composio"&&Object.values(state.users[r.user].connections).some(rows=>Object.values(rows).some(c=>c.source==="composio"&&c.external?.brokerConnection===r.connection.id)))throw new IntegrationError("broker_has_linked_connections",409);const profile=state.users[r.user];
    const remaining=Object.fromEntries(Object.entries(profile.connections[provider]).filter(([key])=>key!==r.connection.id));
    profile.connections=Object.fromEntries(Object.entries(profile.connections).map(([key,rows])=>[key,key===provider?remaining:rows]));
    profile.defaults=Object.fromEntries(Object.entries(profile.defaults).filter(([key,value])=>key!==provider||value!==r.connection.id));});
}
export function summarizeInfraProvider(id: InfraProviderRef, values: InfraProviderValues): InfraProviderSummary {
  const canonical = resolveProviderId(id);
  if (!canonical) throw new Error("unknown infrastructure provider");
  const def = getInfraProviderDefinition(canonical);
  const missing = def.fields.filter((field) => field.required && !values[field.key]).map((field) => field.key);
  if (canonical === "composio" && !values.apiKey && !values.orgApiKey) missing.push("project or organization API key");
  if (canonical === "hostinger" && !values.apiToken && !(values.mailApiToken && values.mailOrderId)) missing.push("account token or scoped Mail API token + order ID");
  if(canonical==="doku"&&!(values.paymentClientId&&values.paymentSecretKey&&values.paymentEnvironment)&&!(values.mcpClientId&&values.mcpApiKey&&values.environment))missing.push("Payment Client ID + Secret Key or MCP Client ID + API Key, plus environment");
  if (canonical === "convex") {
    const kind = convexDeploymentKind(values);
    if (kind === "self-hosted" ? !(values.apiUrl && values.adminKey) : !values.personalToken && !(values.deployKey && values.deploymentName)) missing.push(kind === "self-hosted" ? "self-hosted deployment URL and admin key" : "Convex Cloud personal token or deployment key and name");
  }
  const safeValues = Object.fromEntries(def.fields
    .filter((field) => values[field.key])
    .map((field) => [field.key, field.secret ? mask(values[field.key]) : values[field.key]]));
  return { id: canonical, title: def.title, description: def.description, feature: def.feature, configured: missing.length === 0, missing, values: safeValues, fields: def.fields };
}
