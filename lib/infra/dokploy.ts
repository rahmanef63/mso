import type { InfraProviderValues } from "./types";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { readInfraProvider } from "./store";
import { obj, request, TIMEOUT_MS } from "./http";
import { redactText } from "@/lib/security/redact-text";

function dokployFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestInput = new Request(input, { ...init, redirect: "error" });
  const host = new URL(requestInput.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // Loopback is an explicit same-host Dokploy case. All remote endpoints use the
  // DNS-pinned safe transport so DNS rebinding/private metadata routes are refused.
  if (["127.0.0.1", "localhost", "::1"].includes(host)) return fetch(requestInput);
  return safeProviderFetch(requestInput);
}

async function call(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  const values = await readInfraProvider("dokploy");
  if (!values.apiUrl || !values.apiKey) throw new Error("Dokploy is not configured; run `mso provider set dokploy`");
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(`${values.apiUrl}${endpoint}`, {
        method,
        headers: { "x-api-key": values.apiKey, accept: "application/json", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, TIMEOUT_MS, dokployFetch);
      if (res.ok) return res.body;
      if (res.status !== 429 && res.status < 500) throw new Error(`Dokploy HTTP ${res.status}`);
      last = new Error(`Dokploy HTTP ${res.status}`);
    } catch (error) {
      last = new Error(/^Dokploy HTTP \d{3}$/.test((error as Error).message)?(error as Error).message:"Dokploy request failed");
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw last ?? new Error("Dokploy request failed");
}

export async function doctorDokploy(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("dokploy");
  if (!values.apiUrl || !values.apiKey) return null;
  const res = await request(`${values.apiUrl}/project.all`, {
    headers: { "x-api-key": values.apiKey, accept: "application/json" },
  }, TIMEOUT_MS, dokployFetch);
  if (!res.ok) throw new Error(`Dokploy HTTP ${res.status}`);
  return `reachable; ${Array.isArray(res.body) ? res.body.length : 0} project(s)`;
}

export async function listDokployProjects(): Promise<Array<{ projectId: string; name: string }>> {
  const rows = await call("/project.all");
  if (!Array.isArray(rows)) throw new Error("Dokploy project.all returned an unexpected response");
  return rows
    .map((row) => obj(row))
    .map((row) => ({ projectId: String(row.projectId ?? row.id ?? ""), name: String(row.name ?? "") }))
    .filter((row) => row.projectId && row.name);
}

export async function ensureDokployProject(name: string): Promise<{ projectId: string; name: string; created: boolean }> {
  const clean = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(clean)) throw new Error("invalid Dokploy project name");
  const existing = (await listDokployProjects()).find((row) => row.name === clean);
  if (existing) return { ...existing, created: false };
  await call("/project.create", "POST", { name: clean });
  const created = (await listDokployProjects()).find((row) => row.name === clean);
  if (!created) throw new Error("Dokploy project create returned success but the project is still absent");
  return { ...created, created: true };
}


const DOKPLOY_ID = /^[A-Za-z0-9_-]{8,80}$/;
const PUBLIC_BUILD_ENV = /^(?:BATON_BUILD_SHA|(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)[A-Z0-9_]+)$/;

function dokployId(value: string, label: string): string {
  const clean = value.trim();
  if (!DOKPLOY_ID.test(clean)) throw new Error(`invalid Dokploy ${label}`);
  return clean;
}

export type DokployApplicationSummary = {
  projectId: string;
  environmentId: string;
  environment: string;
  applicationId: string;
  name: string;
  appName: string;
  status: string | null;
};

export async function listDokployApplications(projectId: string): Promise<DokployApplicationSummary[]> {
  const id = dokployId(projectId, "project id");
  const payload = await call(`/environment.byProjectId?projectId=${encodeURIComponent(id)}`);
  const environments = Array.isArray(payload) ? payload : [];
  const rows: DokployApplicationSummary[] = [];
  for (const item of environments) {
    const environment = obj(item);
    const environmentId = String(environment.environmentId ?? environment.id ?? "");
    const environmentName = String(environment.name ?? "");
    const applications = Array.isArray(environment.applications) ? environment.applications : [];
    for (const raw of applications) {
      const app = obj(raw);
      const applicationId = String(app.applicationId ?? app.id ?? "");
      if (!applicationId) continue;
      rows.push({
        projectId: id,
        environmentId,
        environment: environmentName,
        applicationId,
        name: String(app.name ?? ""),
        appName: String(app.appName ?? ""),
        status: typeof app.applicationStatus === "string" ? app.applicationStatus : null,
      });
    }
  }
  return rows;
}

function quotePublicEnvValue(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.length > 2048) throw new Error("invalid public environment value");
  return /^[A-Za-z0-9_./:@?&=%+,~-]*$/.test(value) ? value : JSON.stringify(value);
}

export function upsertPublicEnvText(source: string, key: string, value: string): { env: string; changed: boolean } {
  const cleanKey = key.trim();
  if (!PUBLIC_BUILD_ENV.test(cleanKey)) throw new Error("only public browser build variables or approved public release metadata may be changed through this operation");
  const encoded = quotePublicEnvValue(value);
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const escaped = cleanKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=`);
  const matches = lines.flatMap((line, index) => matcher.test(line) ? [index] : []);
  if (matches.length > 1) throw new Error(`Dokploy environment contains duplicate ${cleanKey} entries`);
  const replacement = `${cleanKey}=${encoded}`;
  if (matches.length === 1) {
    const index = matches[0]!;
    if (lines[index] === replacement) return { env: source, changed: false };
    lines[index] = replacement;
  } else {
    while (lines.length && lines.at(-1) === "") lines.pop();
    lines.push(replacement, "");
  }
  return { env: lines.join("\n"), changed: true };
}

async function readDokployApplication(applicationId: string): Promise<Record<string, unknown>> {
  const id = dokployId(applicationId, "application id");
  return obj(await call(`/application.one?applicationId=${encodeURIComponent(id)}`));
}

export async function upsertDokployPublicBuildEnv(args: {
  applicationId: string;
  key: string;
  value: string;
}): Promise<{ applicationId: string; key: string; changed: boolean; redeployQueued: boolean }> {
  const applicationId = dokployId(args.applicationId, "application id");
  const before = await readDokployApplication(applicationId);
  const sourceEnv = typeof before.env === "string" ? before.env : "";
  const next = upsertPublicEnvText(sourceEnv, args.key, args.value);
  if (!next.changed) return { applicationId, key: args.key, changed: false, redeployQueued: false };
  await call("/application.saveEnvironment", "POST", {
    applicationId,
    env: next.env,
    buildArgs: typeof before.buildArgs === "string" ? before.buildArgs : null,
    buildSecrets: typeof before.buildSecrets === "string" ? before.buildSecrets : null,
    createEnvFile: before.createEnvFile === true,
  });
  const after = await readDokployApplication(applicationId);
  const verified = upsertPublicEnvText(typeof after.env === "string" ? after.env : "", args.key, args.value);
  if (verified.changed) throw new Error("Dokploy environment update could not be verified");
  await call("/application.deploy", "POST", { applicationId });
  return { applicationId, key: args.key, changed: true, redeployQueued: true };
}

export type DokployDeploymentSummary={deploymentId:string;status:string|null;title:string;description:string;errorMessage:string;createdAt:string};
export async function listDokployDeployments(applicationId:string):Promise<DokployDeploymentSummary[]>{
  const id=dokployId(applicationId,"application id"),payload=await call(`/deployment.all?applicationId=${encodeURIComponent(id)}`);
  if(!Array.isArray(payload))throw new Error("Dokploy deployment.all returned an unexpected response");
  return payload.slice(0,50).map(raw=>{const row=obj(raw);return {deploymentId:String(row.deploymentId??row.id??""),status:typeof row.status==="string"?row.status:null,title:redactText(String(row.title??row.titleLog??""),240),description:redactText(String(row.description??row.descriptionLog??""),500),errorMessage:redactText(String(row.errorMessage??""),1200),createdAt:String(row.createdAt??row.created_at??"")};}).filter(row=>row.deploymentId);
}
export async function readDokployDeploymentLogs(deploymentId:string,tail=160):Promise<{deploymentId:string;logs:string}>{
  const id=dokployId(deploymentId,"deployment id"),safeTail=Math.max(1,Math.min(500,Math.trunc(tail)));
  const payload=await call(`/deployment.readLogs?deploymentId=${encodeURIComponent(id)}&tail=${safeTail}`),record=typeof payload==="object"&&payload?obj(payload):{};
  const raw=typeof payload==="string"?payload:typeof record.logs==="string"?record.logs:typeof record.content==="string"?record.content:JSON.stringify(payload);
  return {deploymentId:id,logs:redactText(raw,16000)};
}

export async function inspectDokployApplication(applicationId:string){
  const row=await readDokployApplication(applicationId);
  return {applicationId:String(row.applicationId??row.id??""),name:String(row.name??""),sourceType:String(row.sourceType??""),repository:String(row.repository??""),owner:String(row.owner??""),branch:String(row.branch??""),buildPath:String(row.buildPath??""),customGitUrl:String(row.customGitUrl??""),customGitBranch:String(row.customGitBranch??""),customGitBuildPath:String(row.customGitBuildPath??""),triggerType:String(row.triggerType??"push"),autoDeploy:row.autoDeploy===true,enableSubmodules:row.enableSubmodules===true,watchPaths:Array.isArray(row.watchPaths)?row.watchPaths.filter(x=>typeof x==="string").slice(0,50):[],githubId:String(row.githubId??""),gitlabId:String(row.gitlabId??""),bitbucketId:String(row.bitbucketId??""),giteaId:String(row.giteaId??""),buildType:String(row.buildType??""),applicationStatus:String(row.applicationStatus??"")};
}
export async function listDokployGitProviders(){
  const payload=await call("/gitProvider.getAll");if(!Array.isArray(payload))throw new Error("Dokploy gitProvider.getAll returned an unexpected response");
  return payload.slice(0,100).map(raw=>{const row=obj(raw),github=row.github&&typeof row.github==="object"?obj(row.github):{};return {gitProviderId:String(row.gitProviderId??row.id??""),name:String(row.name??""),providerType:String(row.providerType??row.type??""),githubId:String(github.githubId??""),githubName:String(github.name??""),githubAppName:String(github.githubAppName??"")};}).filter(row=>row.gitProviderId);
}

export async function listDokployGithubRepositories(githubId:string){
  const id=dokployId(githubId,"github id"),payload=await call(`/github.getGithubRepositories?githubId=${encodeURIComponent(id)}`);
  if(!Array.isArray(payload))throw new Error("Dokploy github.getGithubRepositories returned an unexpected response");
  return payload.slice(0,500).map(raw=>{const row=obj(raw),owner=row.owner&&typeof row.owner==="object"?obj(row.owner):{};return {name:String(row.name??""),fullName:String(row.full_name??row.fullName??""),owner:String(owner.login??row.owner??"")};}).filter(row=>row.name);
}

export async function inspectDokployGithubProvider(githubId:string){const id=dokployId(githubId,"github id"),row=obj(await call(`/github.one?githubId=${encodeURIComponent(id)}`));return {githubId:String(row.githubId??""),name:String(row.name??""),githubAppName:String(row.githubAppName??""),githubInstallationId:String(row.githubInstallationId??""),githubUrl:String(row.githubUrl??"")};}
export async function testDokployGithubProvider(githubId:string){const id=dokployId(githubId,"github id"),payload=await call("/github.testConnection","POST",{githubId:id});const row=obj(payload);return {ok:row.success===true||row.ok===true,message:redactText(String(row.message??row.detail??""),500)};}

export async function deployDokployApplication(applicationId:string){const id=dokployId(applicationId,"application id");await call("/application.deploy","POST",{applicationId:id});return {applicationId:id,redeployQueued:true};}
export async function configureDokployDockerfileBuild(args:{applicationId:string;dockerfile?:string;dockerContextPath?:string}){const applicationId=dokployId(args.applicationId,"application id"),dockerfile=(args.dockerfile??"Dockerfile").trim(),dockerContextPath=(args.dockerContextPath??".").trim()||".";if(!/^[A-Za-z0-9._\-/]{1,240}$/.test(dockerfile)||dockerfile.startsWith("/")||dockerfile.includes(".."))throw new Error("invalid Dokploy Dockerfile path");if(!/^(?:\.|\/?[A-Za-z0-9._\-/]{0,239})$/.test(dockerContextPath)||dockerContextPath.includes(".."))throw new Error("invalid Dokploy Docker context path");await call("/application.saveBuildType","POST",{applicationId,buildType:"dockerfile",dockerfile,dockerContextPath,dockerBuildStage:null,herokuVersion:null,railpackVersion:null});const after=await inspectDokployApplication(applicationId);if(after.buildType!=="dockerfile")throw new Error("Dokploy Dockerfile build type could not be verified");return {applicationId,buildType:after.buildType,dockerfile,dockerContextPath};}


const DOKPLOY_GIT_PART=/^[A-Za-z0-9_.-]{1,180}$/,DOKPLOY_BRANCH=/^[A-Za-z0-9._\-/#]{1,180}$/,DOKPLOY_BUILD_PATH=/^\/?[A-Za-z0-9._\-/]*$/,DOKPLOY_HOST=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export async function ensureDokployGithubApplication(args:{projectId:string;name:string;githubId:string;owner:string;repository:string;branch:string;buildPath?:string}){
  const projectId=dokployId(args.projectId,"project id"),githubId=dokployId(args.githubId,"github id"),name=args.name.trim(),owner=args.owner.trim(),repository=args.repository.trim(),branch=args.branch.trim(),buildPath=(args.buildPath??"/").trim()||"/";if(!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(name))throw new Error("invalid Dokploy application name");if(!DOKPLOY_GIT_PART.test(owner)||!DOKPLOY_GIT_PART.test(repository)||!DOKPLOY_BRANCH.test(branch)||!DOKPLOY_BUILD_PATH.test(buildPath))throw new Error("invalid Dokploy GitHub source metadata");const provider=await inspectDokployGithubProvider(githubId);if(provider.githubId!==githubId)throw new Error("Dokploy GitHub provider could not be verified");const repositories=await listDokployGithubRepositories(githubId);if(!repositories.some(row=>row.name===repository&&row.owner===owner))throw new Error("repository is not accessible through the selected Dokploy GitHub provider");let environmentsRaw=await call(`/environment.byProjectId?projectId=${encodeURIComponent(projectId)}`),environments=Array.isArray(environmentsRaw)?environmentsRaw.map(obj):[];if(!environments.length){await call("/environment.create","POST",{name:"Production",projectId});environmentsRaw=await call(`/environment.byProjectId?projectId=${encodeURIComponent(projectId)}`);environments=Array.isArray(environmentsRaw)?environmentsRaw.map(obj):[];}const environment=environments.find(row=>row.isDefault===true)||environments.find(row=>String(row.name??"").toLowerCase()==="production")||environments[0],environmentId=String(environment?.environmentId??environment?.id??"");if(!environmentId)throw new Error("Dokploy project has no usable environment");const apps=await listDokployApplications(projectId);let app=apps.find(row=>row.name===name||row.appName===name),created=false;if(!app){await call("/application.create","POST",{name,environmentId,sourceType:"github"});app=(await listDokployApplications(projectId)).find(row=>row.name===name||row.appName===name);created=true;}if(!app)throw new Error("Dokploy application create returned success but the application is absent");const applicationId=dokployId(app.applicationId,"application id");await call("/application.saveGithubProvider","POST",{applicationId,repository,owner,buildPath,githubId,branch,triggerType:"push",enableSubmodules:false,watchPaths:[]});const after=await inspectDokployApplication(applicationId);if(after.sourceType!=="github"||after.githubId!==githubId||after.owner!==owner||after.repository!==repository||after.branch!==branch)throw new Error("Dokploy GitHub application source could not be verified");return {projectId,environmentId,applicationId,name:after.name||name,sourceType:after.sourceType,owner,repository,branch,buildPath,created};
}
export async function ensureDokployApplicationDomain(args:{applicationId:string;host:string;port:number;https:boolean}){const applicationId=dokployId(args.applicationId,"application id"),host=args.host.trim().toLowerCase(),port=Math.trunc(args.port);if(!DOKPLOY_HOST.test(host))throw new Error("invalid Dokploy domain host");if(port<1||port>65535)throw new Error("invalid Dokploy domain port");const payload=await call(`/domain.byApplicationId?applicationId=${encodeURIComponent(applicationId)}`),domains=Array.isArray(payload)?payload.map(obj):[];let row=domains.find(item=>String(item.host??"").toLowerCase()===host),created=false;if(!row){await call("/domain.create","POST",{host,port,https:args.https,applicationId,certificateType:args.https?"letsencrypt":"none"});created=true;const next=await call(`/domain.byApplicationId?applicationId=${encodeURIComponent(applicationId)}`);row=(Array.isArray(next)?next.map(obj):[]).find(item=>String(item.host??"").toLowerCase()===host);}if(!row)throw new Error("Dokploy domain create returned success but the domain is absent");const domainId=String(row.domainId??row.id??"");if(!domainId)throw new Error("Dokploy domain has no id");const currentPort=Number(row.port??port),currentHttps=row.https===true;if(currentPort!==port||currentHttps!==args.https)await call("/domain.update","POST",{domainId,host,port,https:args.https,certificateType:args.https?"letsencrypt":"none"});const verify=await call(`/domain.byApplicationId?applicationId=${encodeURIComponent(applicationId)}`),verified=(Array.isArray(verify)?verify.map(obj):[]).find(item=>String(item.host??"").toLowerCase()===host);if(!verified||Number(verified.port??port)!==port||Boolean(verified.https)!==args.https)throw new Error("Dokploy domain could not be verified");return {applicationId,domainId,host,port,https:args.https,created};}
export async function recoverDokployPublicGithubToHttpsGit(applicationId:string){
  const id=dokployId(applicationId,"application id"),before=await readDokployApplication(id);
  if(before.sourceType!=="github")throw new Error("Dokploy application is not using the GitHub source provider");
  const owner=String(before.owner??""),repository=String(before.repository??""),branch=String(before.branch??"main"),buildPath=String(before.buildPath??"/");
  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,180}$/.test(repository)||!/^[A-Za-z0-9._\-/#]{1,180}$/.test(branch)||!/^\/?[A-Za-z0-9._\-/]*$/.test(buildPath))throw new Error("unsafe Dokploy GitHub source metadata");
  const customGitUrl=`https://github.com/${owner}/${repository}.git`,watchPaths=Array.isArray(before.watchPaths)?before.watchPaths.filter(x=>typeof x==="string").slice(0,50):[];
  await call("/application.saveGitProvider","POST",{applicationId:id,customGitBuildPath:buildPath,customGitUrl,watchPaths,enableSubmodules:before.enableSubmodules===true,customGitBranch:branch,customGitSSHKeyId:null});
  const after=await readDokployApplication(id);if(after.sourceType!=="git"||after.customGitUrl!==customGitUrl||after.customGitBranch!==branch)throw new Error("Dokploy HTTPS Git recovery could not be verified");
  await call("/application.deploy","POST",{applicationId:id});return {applicationId:id,sourceType:"git",customGitUrl,branch,redeployQueued:true};
}
