import { listInfraProviderDefinitions, getInfraProviderDefinition, isInfraProviderId } from "./catalog";
import { setupFields, setupGuidance, setupMethods, type SetupMethod } from "./setup-guidance";
import { IntegrationError, type ConnectionSource, type IntegrationConnection } from "./identity";
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
  if (!isInfraProviderId(provider)) throw new IntegrationError("unknown_provider",404);
  return getInfraProviderDefinition(provider);
}
export function connectionMethods(provider:string, source:ConnectionSource) {
  const p=providerDefinition(provider);
  if(source==="direct") return setupMethods(p.id).map(m=>({id:m.id as string,label:m.label,scope:provider==="convex-cloud"?(m.id==="deployment"?"deployment":"account"):provider==="composio"?m.id:provider==="dokploy"?"server":"account",fields:setupFields(p.id,m.id),guidance:setupGuidance(p.id,m.id)}));
  if(source==="composio" && COMPOSIO[provider]) return COMPOSIO[provider].methods.map(id=>({id,label:id==="oauth2"?"OAuth2":"Hosted API key",scope:"account",fields:[],guidance:{url:"https://platform.composio.dev",reference:`https://docs.composio.dev/toolkits/${COMPOSIO[provider].toolkit}`,steps:["Configure a Composio project key under this same credential user.","Choose a matching authentication configuration for this provider and method.","Open the hosted authorization link. Enter credentials only on the provider/Composio page.","Return and refresh status. MSO stores routing identifiers, not provider OAuth tokens."]}}));
  if(source==="native-mcp" && NATIVE[provider])return[{id:"provider-oauth",label:"Provider-owned MCP / OAuth",scope:"account",fields:[],guidance:{url:NATIVE[provider].reference,reference:NATIVE[provider].reference,steps:["Connect the provider-owned MCP server in your client.","Complete authorization in that provider's browser flow.","Use this named MSO connection to identify the intended provider route; the authenticated MCP session remains client-owned.","MSO does not copy provider access/refresh tokens or silently fall back to a local key."]}}];
  throw new IntegrationError("unsupported_connection_source");
}
export function connectionMethod(provider:string,source:ConnectionSource,method?:string){
  const methods=connectionMethods(provider,source), selected=method?methods.find(m=>m.id===method):methods[0];
  if(!selected)throw new IntegrationError("unsupported_auth_method");return selected;
}
export function connectionSources(provider:string){return ["direct",...(COMPOSIO[provider]?["composio"]:[]),...(NATIVE[provider]?["native-mcp"]:[])] as ConnectionSource[];}
export function connectionCatalog(){return listInfraProviderDefinitions().map(p=>({id:p.id,title:p.title,description:p.description,sources:connectionSources(p.id).map(id=>({id,label:id==="direct"?"MSO direct":id==="composio"?"Composio":"Provider MCP",methods:connectionMethods(p.id,id)}))}));}
export function connectionSummary(user:string,c:IntegrationConnection,isDefault=false){
  const method=connectionMethod(c.provider,c.source,c.authMethod),missing=method.fields.filter(f=>f.required&&!c.values[f.key]).map(f=>f.key);
  return {user,id:c.id,label:c.label,provider:c.provider,source:c.source,authMethod:c.authMethod,scope:c.scope,revision:c.revision,isDefault,missing,fields:method.fields.map(f=>({...f,stored:Boolean(c.values[f.key])})),state:c.source==="direct"?(missing.length?"incomplete":c.verifiedAt?"verified":"configured"):c.external?.status??"authorization-required",verifiedAt:c.verifiedAt??null,external:c.external??null};
}
export const composioDefinition=(provider:string)=>COMPOSIO[provider];
export const nativeDefinition=(provider:string)=>NATIVE[provider];
export function legacyMethod(provider:string,values:Record<string,string>):SetupMethod {
  return provider==="composio"?(values.orgApiKey?"organization":"project"):provider==="convex-cloud"?(values.deployKey?"deployment":"personal"):"direct";
}
