import { ApiError } from "../host-api.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import {
  readCloudflareZones, readDokployProjects, readInfraProviderRows, runInfraDoctor,
  type CloudflareZone, type DokployProject, type DoctorResult, type InfraProviderRow,
} from "./infra-workspace-api.ts";

export type InfraTab = "providers" | "dokploy" | "cloudflare";

export type InfraWorkspaceState =
  | { kind: "loading"; tab: InfraTab }
  | {
      kind: "ready"; tab: InfraTab;
      providers: InfraProviderRow[]; doctor: DoctorResult[];
      projects: DokployProject[]; zones: CloudflareZone[];
      inventoryError: string | null; doctorBusy: boolean;
    }
  | { kind: "error"; tab: InfraTab; message: string; forbidden?: boolean };

/** Owner-only state owner for the Infrastructure window: one provider read, a shared tab,
 *  and inventory that degrades into a notice instead of hiding the provider list. */
export function createInfraWorkspaceController(
  update: (state: InfraWorkspaceState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let tab: InfraTab = "providers";
  let providers: InfraProviderRow[] = [];
  let projects: DokployProject[] = [];
  let zones: CloudflareZone[] = [];
  let doctor: DoctorResult[] = [];
  let doctorBusy = false;

  const emit = (inventoryError: string | null) => {
    if (disposed) return;
    update({ kind: "ready", tab, providers, doctor, projects, zones, inventoryError, doctorBusy });
  };

  async function loadInventory(signal: AbortSignal): Promise<string | null> {
    const wantsProjects = providers.some((row) => row.id === "dokploy" && row.configured);
    const wantsZones = providers.some((row) => row.id === "cloudflare" && row.configured);
    if (!wantsProjects && !wantsZones) { projects = []; zones = []; return null; }
    const [projectResult, zoneResult] = await Promise.allSettled([
      wantsProjects ? readDokployProjects(signal, fetcher, bridge) : Promise.resolve(projects),
      wantsZones ? readCloudflareZones(signal, fetcher, bridge) : Promise.resolve(zones),
    ]);
    const failures: string[] = [];
    if (projectResult.status === "fulfilled") projects = projectResult.value;
    else if (!signal.aborted) failures.push("Dokploy projects could not be listed.");
    if (zoneResult.status === "fulfilled") zones = zoneResult.value;
    else if (!signal.aborted) failures.push("Cloudflare zones could not be listed.");
    return failures.length ? failures.join(" ") : null;
  }

  async function refresh() {
    if (disposed) return;
    const run = ++generation;
    active?.abort();
    const controller = (active = new AbortController());
    update({ kind: "loading", tab });
    try {
      providers = await readInfraProviderRows(controller.signal, fetcher, bridge);
      if (disposed || run !== generation) return;
      const inventoryError = await loadInventory(controller.signal);
      if (disposed || run !== generation) return;
      emit(inventoryError);
    } catch (error) {
      if (disposed || run !== generation || controller.signal.aborted) return;
      const forbidden = error instanceof ApiError && error.status === 403;
      update({
        kind: "error", tab,
        message: error instanceof ApiError ? error.message : "Could not load infrastructure. Check the backend and retry.",
        ...(forbidden ? { forbidden } : {}),
      });
    }
  }

  return {
    refresh,
    async setTab(next: InfraTab) {
      tab = next;
      await refresh();
    },
    async runDoctor(id: string | null): Promise<DoctorResult[]> {
      if (disposed) return [];
      doctorBusy = true;
      emit(null);
      try {
        const results = await runInfraDoctor(id, new AbortController().signal, fetcher, bridge);
        if (!disposed) doctor = results;
        return results;
      } catch (error) {
        if (!disposed) {
          doctor = [{ id: id ?? "all", ok: false, detail: error instanceof ApiError ? error.message : "Diagnostics failed." }];
        }
        return [];
      } finally {
        if (!disposed) { doctorBusy = false; emit(null); }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
