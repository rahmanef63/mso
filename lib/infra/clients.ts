import type { InfraDoctorResult, InfraProviderId, InfraProviderValues } from "./types";
import { doctorCloudflare } from "./cloudflare";
import { doctorDokploy } from "./dokploy";
import { doctorHostinger } from "./hostinger";
import { doctorComposio } from "./composio";

export { listCloudflareZones, upsertCloudflareDns } from "./cloudflare";
export { ensureDokployProject, listDokployProjects } from "./dokploy";
export { upsertHostingerDns } from "./hostinger";

export async function doctorInfraProvider(id: InfraProviderId, candidate?: InfraProviderValues): Promise<InfraDoctorResult> {
  try {
    const detail = id === "dokploy"
      ? await doctorDokploy(candidate)
      : id === "cloudflare"
        ? await doctorCloudflare(candidate)
        : id === "composio"
          ? await doctorComposio(candidate)
          : await doctorHostinger(candidate);
    return detail === null ? { id, ok: null, detail: "not configured" } : { id, ok: true, detail };
  } catch (error) {
    return { id, ok: false, detail: (error as Error).message.slice(0, 300) };
  }
}
