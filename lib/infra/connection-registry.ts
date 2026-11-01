import { GOOGLE_READ_OPERATIONS } from "./google-api-catalog";
import { isGoogleProvider, GOOGLE_APP_PROVIDER, googleRedirectUri, googlePublicOrigin } from "./google-native-config";
import { canonicalProviderId, convexDeploymentKind, listInfraProviderDefinitions, getInfraProviderDefinition, resolveProviderId } from "./catalog";
import { setupFields, setupGuidance, setupMethods, type SetupMethod } from "./setup-guidance";
import { IntegrationError, type ConnectionSource, type IntegrationConnection } from "./identity";
import { integrationReference } from "./connection-reference";
/** Convex keeps every pre-collapse method id; `admin` is the self-hosted shape. */
const CONVEX_METHODS = ["personal", "deployment", "admin"] as const;
/**
 * The stored method id for a values bag, used by the legacy projection and
 * credential deletion. Inference matches `convexDeploymentKind`: an `apiUrl`
 * means the self-hosted (`admin`) shape even on a row that predates the field.
 */
export function convexMethod(values: Record<string, string>): SetupMethod {
  if (convexDeploymentKind(values) === "self-hosted") return "admin";
  return values.deployKey || values.deploymentName ? "deployment" : "personal";
}
export const convexMethods = () => [...CONVEX_METHODS];
const COMPOSIO: Record<string, {toolkit:string; managed:boolean; methods:string[]}> = {
  github:{toolkit:"github",managed:true,methods:["oauth2"]}, vercel:{toolkit:"vercel",managed:false,methods:["oauth2","api-key"]},
  cloudflare:{toolkit:"cloudflare",managed:false,methods:["api-key"]}, resend:{toolkit:"resend",managed:false,methods:["api-key"]},
  stripe:{toolkit:"stripe",managed:false,methods:["api-key"]}, supabase:{toolkit:"supabase",managed:false,methods:["oauth2","api-key"]},
};
const NATIVE: Record<string,{url:string;reference:string}> = {
  vercel:{url:"https://mcp.vercel.com",reference:"https://vercel.com/docs/mcp/vercel-mcp"},
  github:{url:"https://api.githubcopilot.com/mcp/",reference:"https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/use-the-github-mcp-server"},
  supabase:{url:"https://mcp.supabase.com/mcp",reference:"https://supabase.com/docs/guides/getting-started/mcp"},
};
export function providerDefinition(provider:string) {
  const id = resolveProviderId(provider);
  if (!id) throw new IntegrationError("unknown_provider",404);
  return getInfraProviderDefinition(id);
}
export function connectionMethods(provider:string, source:ConnectionSource) {
  const p=providerDefinition(provider), id=p.id;
  if(source==="direct") return setupMethods(p.id).map(m=>({id:m.id as string,label:provider==="github"?"Personal access token fallback":m.label,scope:id===GOOGLE_APP_PROVIDER?"client-configuration":isGoogleProvider(id)?"read-only-account":id==="convex"?(m.id==="admin"?"self-hosted":m.id==="deployment"?"deployment":"account"):id==="composio"?m.id:id==="dokploy"?"server":id==="hostinger"&&m.id==="mail"?"mail-order":id==="doku"?"merchant":"account",fields:setupFields(p.id,m.id),guidance:setupGuidance(p.id,m.id)}));
  if(source==="composio" && COMPOSIO[provider]) return COMPOSIO[provider].methods.map(id=>({id,label:id==="oauth2"?"OAuth2":"Hosted API key",scope:"account",fields:[],guidance:{url:"https://platform.composio.dev",reference:`https://docs.composio.dev/toolkits/${COMPOSIO[provider].toolkit}`,steps:["Configure a Composio project key under this same credential user.","Choose a matching authentication configuration for this provider and method.","Open the hosted authorization link. Enter credentials only on the provider/Composio page.","Return and refresh status. MSO stores routing identifiers, not provider OAuth tokens."]}}));
  if(source==="native-mcp" && NATIVE[provider])return[{id:"provider-oauth",label:"Provider-owned MCP / OAuth",scope:"account",fields:[],guidance:{url:NATIVE[provider].reference,reference:NATIVE[provider].reference,steps:["Connect the provider-owned MCP server in your client.","Complete authorization in that provider's browser flow.","Use this named MSO connection to identify the intended provider route; the authenticated MCP session remains client-owned.","MSO does not copy provider access/refresh tokens or silently fall back to a local key."]}}];
  throw new IntegrationError("unsupported_connection_source");
}
export function connectionMethod(provider:string,source:ConnectionSource,method?:string){
  // A caller may still hold the retired convex id; resolve it before any lookup.
  const canonical=canonicalProviderId(provider), methods=connectionMethods(canonical,source);
  const selected=method?methods.find(m=>m.id===method):methods[0];
  if(selected)return selected;
  // A store written before the collapse recorded the self-hosted Convex row as
  // authMethod "direct". Keep that stored id readable WITHOUT advertising a fourth
  // method in the picker — setupMethods stays the advertised list.
  if(canonical==="convex"&&source==="direct"&&method==="direct")
    return {id:"direct",label:"Self-hosted Convex (legacy) direct credential",scope:"self-hosted",fields:setupFields(canonical,"direct"),guidance:setupGuidance(canonical,"direct")};
  throw new IntegrationError("unsupported_auth_method");
}
export function connectionSources(provider:string){
  const oauthFirst = provider === "github";
  return (oauthFirst
    ? [...(COMPOSIO[provider]?["composio"]:[]),...(NATIVE[provider]?["native-mcp"]:[]),"direct"]
    : ["direct",...(COMPOSIO[provider]?["composio"]:[]),...(NATIVE[provider]?["native-mcp"]:[])]) as ConnectionSource[];
}
function sourceLabel(provider:string,id:ConnectionSource){
  if(provider==="github") return id==="composio"?"Hosted OAuth (Composio)":id==="native-mcp"?"Provider OAuth / MCP":"Manual token fallback";
  return id==="direct"?"MSO direct":id==="composio"?"Composio":"Provider MCP";
}
export function connectionCatalog(){return listInfraProviderDefinitions().map(p=>({id:p.id,title:p.title,description:p.description,...googleCatalogInfo(p.id),sources:connectionSources(p.id).map(id=>({id,label:sourceLabel(p.id,id),methods:connectionMethods(p.id,id)}))}));}
export function connectionSummary(user:string,c:IntegrationConnection,isDefault=false,values:Record<string,string>=c.values){
  const method=connectionMethod(c.provider,c.source,c.authMethod),missing=method.fields.filter(f=>f.required&&!values[f.key]).map(f=>f.key);
  return {user,id:c.id,label:c.label,provider:c.provider,reference:integrationReference({user,provider:c.provider,connection:c.id}),source:c.source,authMethod:c.authMethod,scope:c.scope,revision:c.revision,isDefault,missing,fields:method.fields.map(f=>({...f,stored:Boolean(values[f.key])})),state:c.source==="direct"?(missing.length?"incomplete":c.lastCheck?(c.lastCheck.revision===c.revision?c.lastCheck.result:"configured"):c.verifiedAt?"verified":"configured"):c.external?.status??"authorization-required",verifiedAt:c.verifiedAt??null,lastCheck:c.lastCheck?.revision===c.revision?c.lastCheck:null,sharedFrom:c.sharedFrom??null,external:c.external??null};
}
export const composioDefinition=(provider:string)=>COMPOSIO[provider];
export const nativeDefinition=(provider:string)=>NATIVE[provider];
export function legacyMethod(provider:string,values:Record<string,string>):SetupMethod {
  return provider==="composio"?(values.orgApiKey?"organization":"project"):canonicalProviderId(provider)==="convex"?convexMethod(values):provider==="doku"?(values.paymentClientId||values.paymentSecretKey?"payment":"mcp"):"direct";
}

function googleCatalogInfo(provider:string){
  if(provider!==GOOGLE_APP_PROVIDER&&!isGoogleProvider(provider))return{};
  let callbackUrl:string|null=null,openPath:string|null=null;try{callbackUrl=googleRedirectUri();openPath=googlePublicOrigin()+"/integrations?provider="+provider}catch{}
  return{nativeGoogle:true,configurationOnly:provider===GOOGLE_APP_PROVIDER,callbackUrl,openPath,operations:GOOGLE_READ_OPERATIONS.filter(op=>op.provider===provider)};
}
