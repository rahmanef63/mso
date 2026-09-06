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
const PUBLIC_BUILD_ENV = /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)[A-Z0-9_]+$/;

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
  if (!PUBLIC_BUILD_ENV.test(cleanKey)) throw new Error("only public browser build environment variables may be changed through this operation");
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
