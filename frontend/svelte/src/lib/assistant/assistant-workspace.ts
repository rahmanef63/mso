import type { ShellBridge } from "../shell-bridge.ts";
import type { AssistantWireMessage } from "./assistant-api.ts";
import {
  deleteThreadRecord,
  listAgentProfiles,
  listAgentSessions,
  listAgentTools,
  listThreads,
  loadThreadById,
  readCockpitSnapshot,
  renameThreadRecord,
  saveThreadRecord,
} from "./assistant-cockpit-api.ts";
import type { AssistantMessage, AssistantState, ThreadRecord, ThreadSummary } from "./assistant-types.ts";

export type WorkspaceControllerDeps = {
  fetcher: typeof fetch;
  getBridge: () => ShellBridge;
  getState: () => AssistantState;
  isDisposed: () => boolean;
  emit: (patch: Partial<AssistantState>) => void;
  abortActiveStream: () => number;
  isChatCurrent: (gen: number) => boolean;
  toWireHistory: (messages: AssistantMessage[]) => AssistantWireMessage[];
};

function deriveTitle(messages: AssistantMessage[], existing: string | null): string {
  if (existing && existing.trim()) return existing.trim().slice(0, 120);
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  return (firstUser?.text.replace(/\s+/g, " ").trim() || "New chat").slice(0, 80);
}

export function createWorkspaceActions(deps: WorkspaceControllerDeps) {
  let seq = 0;
  let workspaceGen = 0;
  let workspaceAbort: AbortController | undefined;
  const localThreads = new Map<string, ThreadRecord>();

  const upsertSummary = (summary: ThreadSummary): ThreadSummary[] => {
    const rest = deps.getState().threads.filter((t) => t.id !== summary.id);
    return [summary, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
  };

  function persistCurrentThread(messages: AssistantMessage[]): void {
    const st = deps.getState();
    if (deps.isDisposed() || messages.length === 0) return;
    if (st.threadsStatus !== "ready" && st.threadsStatus !== "offline") return;
    const now = Date.now();
    const id = st.activeThreadId ?? `thread_${now.toString(36)}_${++seq}`;
    const createdAt = st.activeThreadCreatedAt || now;
    const title = deriveTitle(messages, st.activeThreadTitle);
    const history = deps.toWireHistory(messages);
    localThreads.set(id, { id, title, createdAt, updatedAt: now, messages, history });
    deps.emit({
      activeThreadId: id,
      activeThreadTitle: title,
      activeThreadCreatedAt: createdAt,
      threads: upsertSummary({ id, title, createdAt, updatedAt: now }),
    });
    if (st.threadsStatus === "ready") {
      const ctrl = new AbortController();
      void saveThreadRecord({ id, title, createdAt, messages, history }, ctrl.signal, deps.fetcher, deps.getBridge()).catch(() => {});
    }
  }

  async function loadThreads(): Promise<void> {
    if (deps.isDisposed()) return;
    const ctrl = new AbortController();
    deps.emit({ threadsStatus: "loading" });
    try {
      const res = await listThreads(ctrl.signal, deps.fetcher, deps.getBridge());
      if (deps.isDisposed()) return;
      const merged = res.status === "ready"
        ? res.threads
        : [...localThreads.values()].map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
      deps.emit({ threads: merged, threadsStatus: res.status, threadsNote: res.note });
    } catch {
      if (!deps.isDisposed()) deps.emit({ threadsStatus: "offline", threadsNote: "Threads are available locally in this session." });
    }
  }

  async function refreshInspector(): Promise<void> {
    if (deps.isDisposed()) return;
    const run = ++workspaceGen;
    workspaceAbort?.abort();
    const ctrl = (workspaceAbort = new AbortController());
    deps.emit({ profilesStatus: "loading", toolsStatus: "loading", sessionsStatus: "loading" });
    try {
      const bridge = deps.getBridge();
      const [profilesRes, toolsRes, sessionsRes, cockpitRes] = await Promise.all([
        listAgentProfiles(ctrl.signal, deps.fetcher, bridge),
        listAgentTools(ctrl.signal, deps.fetcher, bridge),
        listAgentSessions(ctrl.signal, deps.fetcher, bridge),
        readCockpitSnapshot(ctrl.signal, deps.fetcher, bridge),
      ]);
      if (deps.isDisposed() || run !== workspaceGen) return;
      const activeId = deps.getState().activeProfileId;
      const keepProfile = activeId && profilesRes.profiles.some((p) => p.id === activeId && p.enabled);
      deps.emit({
        profiles: profilesRes.profiles,
        profilesStatus: profilesRes.status,
        profilesNote: profilesRes.note,
        activeProfileId: keepProfile ? activeId : null,
        tools: toolsRes.tools,
        toolsScope: toolsRes.scope,
        toolsStatus: toolsRes.status,
        toolsNote: toolsRes.note,
        sessions: sessionsRes.sessions,
        sessionsStatus: sessionsRes.status,
        sessionsNote: sessionsRes.note,
        cockpit: cockpitRes.snapshot,
      });
    } catch {
      if (!deps.isDisposed() && run === workspaceGen) {
        deps.emit({ profilesStatus: "offline", toolsStatus: "offline", sessionsStatus: "offline" });
      }
    } finally {
      if (workspaceAbort === ctrl) workspaceAbort = undefined;
    }
  }

  async function selectThread(id: string): Promise<void> {
    if (deps.isDisposed() || !id) return;
    const activeChat = deps.abortActiveStream();
    const local = localThreads.get(id);
    if (deps.getState().threadsStatus !== "ready" && local) {
      deps.emit({
        activeThreadId: local.id, activeThreadTitle: local.title, activeThreadCreatedAt: local.createdAt,
        messages: local.messages, streaming: false, error: null, liveActivity: null,
      });
      return;
    }
    const ctrl = new AbortController();
    const loaded = await loadThreadById(id, ctrl.signal, deps.fetcher, deps.getBridge()).catch(() => null);
    if (deps.isDisposed() || !deps.isChatCurrent(activeChat)) return;
    const record = loaded ?? local ?? null;
    if (!record) return;
    localThreads.set(record.id, record);
    deps.emit({
      activeThreadId: record.id, activeThreadTitle: record.title, activeThreadCreatedAt: record.createdAt,
      messages: record.messages, streaming: false, error: null, liveActivity: null,
    });
  }

  async function renameThread(id: string, rawTitle: string): Promise<void> {
    if (deps.isDisposed()) return;
    const title = rawTitle.trim().slice(0, 120);
    if (!title) return;
    const now = Date.now();
    const existing = localThreads.get(id);
    if (existing) localThreads.set(id, { ...existing, title, updatedAt: now });
    const st = deps.getState();
    deps.emit({
      threads: st.threads.map((t) => (t.id === id ? { ...t, title, updatedAt: now } : t)),
      ...(st.activeThreadId === id ? { activeThreadTitle: title } : {}),
    });
    if (st.threadsStatus === "ready") {
      const ctrl = new AbortController();
      const updated = await renameThreadRecord(id, title, ctrl.signal, deps.fetcher, deps.getBridge()).catch(() => null);
      if (updated && !deps.isDisposed()) {
        deps.emit({
          threads: upsertSummary(updated),
          ...(deps.getState().activeThreadId === id ? { activeThreadTitle: updated.title } : {}),
        });
      }
    }
  }

  async function deleteThread(id: string): Promise<void> {
    if (deps.isDisposed()) return;
    localThreads.delete(id);
    const st = deps.getState();
    const deletingActive = st.activeThreadId === id;
    if (deletingActive) deps.abortActiveStream();
    deps.emit({
      threads: st.threads.filter((t) => t.id !== id),
      ...(deletingActive
        ? { activeThreadId: null, activeThreadTitle: null, activeThreadCreatedAt: 0, messages: [], streaming: false, error: null, liveActivity: null }
        : {}),
    });
    if (st.threadsStatus === "ready") {
      const ctrl = new AbortController();
      void deleteThreadRecord(id, ctrl.signal, deps.fetcher, deps.getBridge()).catch(() => {});
    }
  }

  function dispose(): void {
    workspaceGen++;
    workspaceAbort?.abort();
    workspaceAbort = undefined;
  }

  return { persistCurrentThread, loadThreads, refreshInspector, selectThread, renameThread, deleteThread, dispose };
}
