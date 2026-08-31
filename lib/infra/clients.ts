import type { InfraDoctorResult, InfraProviderId } from "./types";
import { doctorCloudflare } from "./cloudflare";
import { doctorDokploy } from "./dokploy";
import { doctorHostinger } from "./hostinger";

export { listCloudflareZones, upsertCloudflareDns } from "./cloudflare";
export { ensureDokployProject, listDokployProjects } from "./dokploy";
export { upsertHostingerDns } from "./hostinger";

export async function doctorInfraProvider(id: InfraProviderId): Promise<InfraDoctorResult> {
  try {
    const detail = id === "dokploy"
      ? await doctorDokploy()
      : id === "cloudflare"
        ? await doctorCloudflare()
        : await doctorHostinger();
    return detail === null ? { id, ok: null, detail: "not configured" } : { id, ok: true, detail };
  } catch (error) {
    return { id, ok: false, detail: (error as Error).message.slice(0, 300) };
  }
}
