// Overview controller: the app list, the local-host discovery snapshot and the
// SSH tunnel summary. Discovery and tunnels are owner-only routes, so each one
// fails independently, and each keeps its own AbortController: refreshing one
// must never cancel the other.
import { ApiError, createManagedAppsController, type ManagedAppsState } from "./managed-apps-api.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import { readDiscovery, readTunnels, type DiscoverySnapshot, type TunnelSnapshot } from "./appdeck-api.ts";

export type AuxState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; message: string };

export type OverviewState = {
  apps: ManagedAppsState;
  discovery: AuxState<DiscoverySnapshot>;
  tunnels: AuxState<TunnelSnapshot>;
};

export const initialOverviewState = (): OverviewState => ({
  apps: { kind: "loading" }, discovery: { kind: "idle" }, tunnels: { kind: "idle" },
});

const FAILED = "Could not complete that request. Check the backend and retry.";

type AuxKey = "discovery" | "tunnels";

export function createAppDeckOverview(apply: (state: OverviewState) => void, fetcher = fetch, bridge?: ShellBridge) {
  let state = initialOverviewState();
  let disposed = false;
  const runs: Record<AuxKey, number> = { discovery: 0, tunnels: 0 };
  const controllers: Partial<Record<AuxKey, AbortController>> = {};

  const set = (patch: Partial<OverviewState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    apply(state);
  };
  const apps = createManagedAppsController((next) => set({ apps: next }), fetcher, bridge);

  function aux<T>(key: AuxKey, load: (signal: AbortSignal) => Promise<T>): Promise<void> {
    const mine = ++runs[key];
    controllers[key]?.abort();
    const controller = (controllers[key] = new AbortController());
    set({ [key]: { kind: "loading" } } as Partial<OverviewState>);
    return load(controller.signal)
      .then((data) => {
        if (disposed || mine !== runs[key]) return;
        set({ [key]: { kind: "ready", data } } as Partial<OverviewState>);
      })
      .catch((error: unknown) => {
        if (disposed || mine !== runs[key] || controller.signal.aborted) return;
        set({ [key]: { kind: "error", message: error instanceof ApiError ? error.message : FAILED } } as Partial<OverviewState>);
      });
  }

  return {
    get state() {
      return state;
    },
    refresh() {
      void apps.refresh();
      void this.discover();
      void this.loadTunnels();
    },
    discover() {
      return aux("discovery", (signal) => readDiscovery(signal, fetcher, bridge));
    },
    loadTunnels() {
      return aux("tunnels", (signal) => readTunnels(signal, fetcher, bridge));
    },
    dispose() {
      disposed = true;
      runs.discovery++;
      runs.tunnels++;
      controllers.discovery?.abort();
      controllers.tunnels?.abort();
      apps.dispose();
    },
  };
}
