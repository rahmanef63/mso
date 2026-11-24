// One owner per open drawer. Every load is generation-guarded so switching tabs
// or closing the drawer cannot land a stale answer, and a lifecycle action
// always re-reads preflight+jobs afterwards: the host, not this client, decides
// what actually changed on the machine.
import { ApiError } from "./managed-apps-api.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import {
  readBackups, readJobs, readLogs, readPreflight, readUpdateStatus, runLifecycle, startInstall, startUpdate,
  type AppLogs, type BackupRecord, type JobSummary, type LifecycleAction, type PreflightReport, type UpdateStatus,
} from "./appdeck-api.ts";

export type DetailTab = "lifecycle" | "jobs" | "backups";
export const DETAIL_TABS: readonly { id: DetailTab; label: string }[] = [
  { id: "lifecycle", label: "Lifecycle" },
  { id: "jobs", label: "Jobs and logs" },
  { id: "backups", label: "Backups" },
];

export type Loadable<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; message: string };

export type DetailState = {
  tab: DetailTab;
  preflight: Loadable<PreflightReport>;
  update: Loadable<UpdateStatus>;
  jobs: Loadable<JobSummary[]>;
  logs: Loadable<AppLogs>;
  backups: Loadable<BackupRecord[]>;
  busy: string | null;
  notice: string | null;
  error: string | null;
  /** Bumped after every completed action, so a viewer can re-read the deck
   *  without diffing notice strings (two identical actions are two events). */
  revision: number;
};

export const initialDetailState = (): DetailState => ({
  tab: "lifecycle", preflight: { kind: "idle" }, update: { kind: "idle" }, jobs: { kind: "idle" },
  logs: { kind: "idle" }, backups: { kind: "idle" }, busy: null, notice: null, error: null, revision: 0,
});

const FAILED = "Could not complete that request. Check the backend and retry.";

export function describeError(error: unknown): string {
  return error instanceof ApiError ? error.message : FAILED;
}

type Deps = { fetcher?: typeof fetch; bridge?: ShellBridge; signal?: AbortSignal };

export function createAppDeckDetail(id: string, apply: (state: DetailState) => void, deps: Deps = {}) {
  const fetcher = deps.fetcher ?? fetch;
  const bridge = deps.bridge;
  const outer = deps.signal ?? new AbortController().signal;
  let state = initialDetailState();
  let disposed = false;
  // One generation and one AbortController per loadable key, never one shared
  // slot: loading preflight and update together must not cancel either.
  const runs = new Map<string, number>();
  const active = new Map<string, AbortController>();

  const set = (patch: Partial<DetailState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    apply(state);
  };
  function signalFor(key: string): AbortSignal {
    active.get(key)?.abort();
    const controller = new AbortController();
    active.set(key, controller);
    return AbortSignal.any([outer, controller.signal]);
  }
  const abortAll = () => {
    for (const controller of active.values()) controller.abort();
    active.clear();
  };

  async function load<T>(key: keyof DetailState, load_: (signal: AbortSignal) => Promise<T>) {
    if (disposed) return;
    const slot = String(key);
    const run = (runs.get(slot) ?? 0) + 1;
    runs.set(slot, run);
    const signal = signalFor(slot);
    set({ [key]: { kind: "loading" } });
    try {
      const data = await load_(signal);
      if (disposed || run !== runs.get(slot)) return;
      set({ [key]: { kind: "ready", data } });
    } catch (error) {
      if (disposed || run !== runs.get(slot) || signal.aborted) return;
      set({ [key]: { kind: "error", message: describeError(error) } });
    }
  }

  // Actions own a separate slot, so a pending tab load never reads as a busy
  // button and a busy button never cancels the reads it already started.
  function actionSignal(): AbortSignal {
    return signalFor("action");
  }

  const api = {
    get state() { return state; },
    setTab(tab: DetailTab) {
      set({ tab, error: null });
    },
    loadPreflight() {
      return load("preflight", (signal) => readPreflight(id, signal, fetcher, bridge));
    },
    loadUpdate() {
      return load("update", (signal) => readUpdateStatus(id, signal, fetcher, bridge));
    },
    loadJobs() {
      return load("jobs", (signal) => readJobs(id, signal, fetcher, bridge));
    },
    loadLogs() {
      return load("logs", (signal) => readLogs(id, signal, fetcher, bridge));
    },
    loadBackups() {
      return load("backups", (signal) => readBackups(id, signal, fetcher, bridge));
    },
    async loadTab(tab: DetailTab = state.tab) {
      const work: Promise<void>[] = [];
      if (tab === "lifecycle") work.push(api.loadPreflight(), api.loadUpdate());
      if (tab === "jobs") work.push(api.loadJobs(), api.loadLogs());
      if (tab === "backups") work.push(api.loadBackups());
      await Promise.all(work);
    },
    async act(action: LifecycleAction) {
      if (state.busy) return;
      set({ busy: `action:${action}`, error: null, notice: null });
      try {
        await runLifecycle(id, action, actionSignal(), fetcher, bridge);
        set({ notice: `${action} requested. Re-reading host state.` });
      } catch (error) {
        set({ error: describeError(error) });
      } finally {
        set({ busy: null, revision: state.revision + 1 });
        await api.loadTab(state.tab);
      }
    },
    async install() {
      if (state.busy) return;
      set({ busy: "install", error: null, notice: null });
      try {
        const job = await startInstall(id, actionSignal(), fetcher, bridge);
        set({ notice: `Install job ${job.id.slice(0, 8)} started.`, tab: "jobs" });
      } catch (error) {
        set({ error: describeError(error) });
      } finally {
        set({ busy: null, revision: state.revision + 1 });
        await api.loadTab(state.tab);
      }
    },
    async update() {
      if (state.busy) return;
      set({ busy: "update", error: null, notice: null });
      try {
        await startUpdate(id, "apply", actionSignal(), fetcher, bridge);
        set({ notice: "Update job started.", tab: "jobs" });
      } catch (error) {
        set({ error: describeError(error) });
      } finally {
        set({ busy: null, revision: state.revision + 1 });
        await api.loadTab(state.tab);
      }
    },
    async uninstall() {
      if (state.busy) return;
      set({ busy: "uninstall", error: null, notice: null });
      try {
        await startUpdate(id, "uninstall", actionSignal(), fetcher, bridge);
        set({ notice: "Uninstall job started." });
      } catch (error) {
        set({ error: describeError(error) });
      } finally {
        set({ busy: null, revision: state.revision + 1 });
        await api.loadTab(state.tab);
      }
    },
    clearNotice() {
      set({ notice: null, error: null });
    },
    dispose() {
      disposed = true;
      abortAll();
      for (const slot of runs.keys()) runs.set(slot, (runs.get(slot) ?? 0) + 1);
    },
  };
  return api;
}
