import { currentIntegrationSelection, resolveIntegration } from "./connection-service";
import { verifyExternalIntegration } from "./connection-external";
import { doctorAdditionalProvider } from "./additional-doctor";
import { readInfraProvider } from "./store";
import type { InfraDoctorResult, InfraProviderId, InfraProviderValues } from "./types";
import { doctorCloudflare } from "./cloudflare";
import { doctorDokploy } from "./dokploy";
import { doctorHostinger } from "./hostinger";
import { doctorComposio } from "./composio";

export { listCloudflareZones, upsertCloudflareDns } from "./cloudflare";
export { ensureDokployProject, listDokployProjects, listDokployApplications, listDokployDeployments, readDokployDeploymentLogs, inspectDokployApplication, listDokployGitProviders, inspectDokployGithubProvider, testDokployGithubProvider, recoverDokployPublicGithubToHttpsGit, deployDokployApplication, upsertDokployPublicBuildEnv } from "./dokploy";
export { upsertHostingerDns } from "./hostinger";
export { listHostingerMailOrders, getHostingerMailPlan, listHostingerMail, listHostingerMailLogs, mutateHostingerMail } from "./hostinger-mail";

export async function doctorInfraProvider(id: InfraProviderId, candidate?: InfraProviderValues): Promise<InfraDoctorResult> {
  try {
    if(!candidate){
      try{const route=await resolveIntegration(id,currentIntegrationSelection());if(route.source!=="direct")return { ...await verifyExternalIntegration(id,{user:route.user,connection:route.id}), id };}catch(error){if(!["connection_not_found","user_required"].includes((error as Error).message))throw error;}
    }
    const detail = id === "dokploy"
      ? await doctorDokploy(candidate)
      : id === "cloudflare"
        ? await doctorCloudflare(candidate)
        : id === "composio"
          ? await doctorComposio(candidate)
          : id === "hostinger" ? await doctorHostinger(candidate) : await doctorAdditionalProvider(id, candidate ?? await readInfraProvider(id));
    return detail === null ? { id, ok: null, detail: "not configured" } : { id, ok: true, detail };
  } catch (error) {
    return { id, ok: false, detail: (error as Error).message.slice(0, 300) };
  }
}
