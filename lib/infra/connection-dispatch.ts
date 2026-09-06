import { integrationManage } from "./connection-manage";
import { integrationQuery, withIntegrationSelection, resolveIntegration } from "./connection-service";
import { authorizeIntegration, composioConnectionCall } from "./connection-external";
import { IntegrationError, identity, metadataOnly, type ConnectionSelector } from "./identity";
import { importConvexCliPersonalConnection } from "./convex-cli-import";
import { listConvexCustomDomains, ensureConvexCustomDomain, getConvexCanonicalUrls, setConvexCanonicalUrl, getConvexEnvPresence } from "./convex-cloud";
import { doctorInfraProvider, ensureDokployProject, listDokployApplications, listDokployDeployments, readDokployDeploymentLogs, recoverDokployPublicGithubToHttpsGit, listDokployProjects, listCloudflareZones, upsertCloudflareDns, upsertDokployPublicBuildEnv, upsertHostingerDns, listHostingerMailOrders, getHostingerMailPlan, listHostingerMail, listHostingerMailLogs, mutateHostingerMail } from "./clients";
import { isInfraProviderId } from "./catalog";
export const safeActionInput=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).filter(([key])=>key!=="workflow_id"));
export const selectionFrom=(a:Record<string,unknown>):ConnectionSelector=>({user:typeof a.user==="string"?a.user:undefined,connection:typeof a.connection==="string"?a.connection:undefined,cwd:typeof a.cwd==="string"?a.cwd:undefined});
export async function manageIntegrationAction(raw:Record<string,unknown>){
  const a=safeActionInput(raw);metadataOnly(a);
  if(a.action==="connection.import-convex-cli"){
    if(a.confirm!==true)throw new IntegrationError("confirmation_required",403);
    if(Object.keys(a).some(k=>!["action","confirm","user","provider","connection"].includes(k)))throw new IntegrationError("invalid_management_fields");
    if(a.provider!=="convex-cloud")throw new IntegrationError("provider_operation_mismatch");
    return importConvexCliPersonalConnection(selectionFrom(a));
  }
  if(a.action!=="connection.authorize")return integrationManage(a);
  if(a.confirm!==true)throw new IntegrationError("confirmation_required",403);
  if(Object.keys(a).some(k=>!["action","confirm","user","provider","connection","authConfigId","brokerConnection","createManaged"].includes(k)))throw new IntegrationError("invalid_management_fields");
  return authorizeIntegration(identity(a.provider,"provider"),selectionFrom(a),{authConfigId:typeof a.authConfigId==="string"?identity(a.authConfigId):undefined,brokerConnection:typeof a.brokerConnection==="string"?identity(a.brokerConnection):undefined,createManaged:a.createManaged===true});
}
export async function executeIntegrationAction(raw:Record<string,unknown>){
  const a=safeActionInput(raw),operation=String(a.operation);
  if(operation==="dokploy.application.publicEnv.upsert"){
    const {arguments:operationArgs,...meta}=a;metadataOnly(meta);
    const args=operationArgs;if(!args||typeof args!=="object"||Array.isArray(args))throw new IntegrationError("invalid_tool_arguments");
    if(Object.keys(args).some(k=>!["applicationId","key","value"].includes(k)))throw new IntegrationError("invalid_tool_arguments");
  }else metadataOnly(a);
  if(Object.keys(a).some(k=>!["user","provider","connection","operation","arguments","tool","confirm"].includes(k)))throw new IntegrationError("invalid_execution_fields");
  const user=identity(a.user,"user"),provider=identity(a.provider,"provider"),connection=identity(a.connection,"connection"),selection={user,connection};
  const route=await resolveIntegration(provider,selection);
  if(operation==="route")return route;
  if(operation==="verify")return withIntegrationSelection(selection,()=>{if(!isInfraProviderId(provider))throw new IntegrationError("unknown_provider");return doctorInfraProvider(provider);});
  if(a.confirm!==true)throw new IntegrationError("confirmation_required",403);
  const args=a.arguments??{};if(!args||typeof args!=="object"||Array.isArray(args))throw new IntegrationError("invalid_tool_arguments");
  if(operation==="composio.tool")return composioConnectionCall(provider,selection,String(a.tool),args as Record<string,unknown>);
  const verbs:Record<string,{provider:string;fields:string[];run:()=>Promise<unknown>}>= {
    "dokploy.projects.list":{provider:"dokploy",fields:[],run:()=>listDokployProjects()},
    "dokploy.applications.list":{provider:"dokploy",fields:["projectId"],run:()=>listDokployApplications(String((args as Record<string,unknown>).projectId))},
    "dokploy.deployments.list":{provider:"dokploy",fields:["applicationId"],run:()=>listDokployDeployments(String((args as Record<string,unknown>).applicationId))},
    "dokploy.deployment.logs":{provider:"dokploy",fields:["deploymentId","tail"],run:()=>readDokployDeploymentLogs(String((args as Record<string,unknown>).deploymentId),Number((args as Record<string,unknown>).tail??160))},
    "dokploy.git.recover":{provider:"dokploy",fields:["applicationId"],run:()=>recoverDokployPublicGithubToHttpsGit(String((args as Record<string,unknown>).applicationId))},
    "dokploy.application.publicEnv.upsert":{provider:"dokploy",fields:["applicationId","key","value"],run:()=>upsertDokployPublicBuildEnv(args as {applicationId:string;key:string;value:string})},
    "dokploy.project.ensure":{provider:"dokploy",fields:["name"],run:()=>ensureDokployProject(String((args as Record<string,unknown>).name))},
    "convex.customDomains.list":{provider:"convex-cloud",fields:["deploymentName"],run:()=>listConvexCustomDomains(String((args as Record<string,unknown>).deploymentName))},
    "convex.customDomain.ensure":{provider:"convex-cloud",fields:["deploymentName","domain","requestDestination"],run:()=>ensureConvexCustomDomain(args as {deploymentName:string;domain:string;requestDestination:"convexCloud"|"convexSite"})},
    "convex.canonical.get":{provider:"convex-cloud",fields:["deploymentName"],run:()=>getConvexCanonicalUrls(String((args as Record<string,unknown>).deploymentName))},
    "convex.env.presence":{provider:"convex-cloud",fields:["deploymentName","names"],run:()=>getConvexEnvPresence(args as {deploymentName:string;names:string[]})},
    "convex.canonical.set":{provider:"convex-cloud",fields:["deploymentName","requestDestination","url"],run:()=>setConvexCanonicalUrl(args as {deploymentName:string;requestDestination:"convexCloud"|"convexSite";url?:string|null})},
    "cloudflare.zones.list":{provider:"cloudflare",fields:[],run:()=>listCloudflareZones()},
    "cloudflare.dns.upsert":{provider:"cloudflare",fields:["name","type","content","ttl","proxied"],run:()=>upsertCloudflareDns(args as Parameters<typeof upsertCloudflareDns>[0])},
    "hostinger.dns.upsert":{provider:"hostinger",fields:["name","type","content","ttl"],run:()=>upsertHostingerDns(args as Parameters<typeof upsertHostingerDns>[0])},
    "hostinger.mail.orders.list":{provider:"hostinger",fields:[],run:()=>listHostingerMailOrders()},
    "hostinger.mail.plan.get":{provider:"hostinger",fields:["orderId"],run:()=>getHostingerMailPlan((args as Record<string,unknown>).orderId)},
    "hostinger.mail.list":{provider:"hostinger",fields:["orderId","resource","page"],run:()=>listHostingerMail((args as Record<string,unknown>).orderId,(args as Record<string,unknown>).resource,(args as Record<string,unknown>).page as number)},
    "hostinger.mail.logs.list":{provider:"hostinger",fields:["orderId","kind","page"],run:()=>listHostingerMailLogs((args as Record<string,unknown>).orderId,(args as Record<string,unknown>).kind,(args as Record<string,unknown>).page as number)},
    "hostinger.mail.mutate":{provider:"hostinger",fields:["orderId","mailboxId","aliasId","forwarderId","autoreplyId","catchallId","localPart","destination","keepCopy","subject","body","displayName","startsAt","endsAt","action"],run:()=>mutateHostingerMail(String((args as Record<string,unknown>).action),args as Record<string,unknown>)},

  };
  const verb=verbs[operation];if(!verb||verb.provider!==provider)throw new IntegrationError("provider_operation_mismatch");
  if(route.source!=="direct")throw new IntegrationError("external_source_requires_own_executor",409);
  if(Object.keys(args).some(k=>!verb.fields.includes(k)))throw new IntegrationError("invalid_tool_arguments");
  return withIntegrationSelection(selection,async()=>({identity:route,result:await verb.run()}));
}
export const queryIntegrationAction=(input:Record<string,unknown>)=>integrationQuery(safeActionInput(input));
