// Wire names are stable environment-key identifiers; native storage remains independent.
export const FIELD_MAP:Record<string,Record<string,string>>={
  github:{GITHUB_TOKEN:'apiKey',GH_OWNER:'owner'},
  dokploy:{DOKPLOY_API_URL:'apiUrl',DOKPLOY_API_KEY:'apiKey',DOKPLOY_PUBLIC_IP:'publicIp'},
  cloudflare:{CLOUDFLARE_API_TOKEN:'apiToken',CLOUDFLARE_ZONE_ID:'zoneId',CLOUDFLARE_ACCOUNT_ID:'accountId'},
  hostinger:{HOSTINGER_API_TOKEN:'apiToken',HOSTINGER_MAIL_API_TOKEN:'mailApiToken',HOSTINGER_MAIL_ORDER_ID:'mailOrderId'},
  composio:{COMPOSIO_API_KEY:'apiKey',COMPOSIO_ORG_API_KEY:'orgApiKey'},
  'convex-cloud':{CONVEX_PERSONAL_ACCESS_TOKEN:'personalToken',CONVEX_DEPLOY_KEY:'deployKey',CONVEX_DEPLOYMENT_NAME:'deploymentName'},
  convex:{CONVEX_ADMIN_KEY:'adminKey',CONVEX_URL:'apiUrl'},
  vercel:{VERCEL_TOKEN:'apiKey',VERCEL_TEAM_ID:'teamId'},
  stripe:{STRIPE_SECRET_KEY:'apiKey',STRIPE_PUBLISHABLE_KEY:'publishableKey',STRIPE_WEBHOOK_SECRET:'webhookSecret'},
  resend:{RESEND_API_KEY:'apiKey',RESEND_FROM_DOMAIN:'fromDomain'},
  clerk:{CLERK_SECRET_KEY:'apiKey',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'publishableKey',NEXT_PUBLIC_CLERK_FRONTEND_API_URL:'frontendUrl'},
  supabase:{SUPABASE_ACCESS_TOKEN:'managementToken',SUPABASE_ORG_ID:'organizationId'},
};
const DIRECT:Record<string,string>={github:'classic-pat',dokploy:'admin-api-key',cloudflare:'api-token',hostinger:'api-token',convex:'self-hosted-admin',vercel:'account-token',stripe:'secret-key',resend:'api-key',clerk:'instance-keys',supabase:'personal-access-token'};
export function wireMethod(provider:string,source:string,method:string){
  if(source!=='direct')return source==='native-mcp'?'provider-oauth':method;
  return provider==='composio'?(method==='organization'?'organization-token':'project-api-key'):provider==='convex-cloud'?(method==='deployment'?'deployment-key':'personal-access-token'):provider==='hostinger'?(method==='mail'?'mail-api-token':'api-token'):DIRECT[provider]??method;
}
export function nativeMethod(provider:string,source:string,method:string){
  if(source==='native-mcp')return ['provider-oauth','dcr-oauth','mcp-oauth'].includes(method)?'provider-oauth':method;
  if(source!=='direct')return method;
  if(provider==='composio')return({'project-api-key':'project','organization-token':'organization'} as Record<string,string>)[method]??method;
  if(provider==='convex-cloud')return({'deployment-key':'deployment','personal-access-token':'personal'} as Record<string,string>)[method]??method;
  if(provider==='hostinger')return({'mail-api-token':'mail','api-token':'direct'} as Record<string,string>)[method]??method;
  return method===DIRECT[provider]?'direct':method;
}
