import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { ApiError, readModels, streamAssistant, type AssistantWireMessage } from "./assistant-api.ts";
import { runSavedProfile } from "./assistant-cockpit-api.ts";
import { findPlaybook } from "./assistant-presets.ts";
import type { AssistantMessage, AssistantState, AssistantToolCall } from "./assistant-types.ts";
import { createWorkspaceActions } from "./assistant-workspace.ts";

export type { AssistantMessage, AssistantState };
export type AssistantControllerOptions = {
  fetcher?: typeof fetch;
  bridge?: ShellBridge;
  initialModel?: string;
  system?: string;
};

export function initialAssistantState(initialModel = ""): AssistantState {
  return {
    models: [], modelsLoading: false, selectedModel: initialModel,
    messages: [], streaming: false, error: null,
    threads: [], threadsStatus: "idle", threadsNote: null,
    activeThreadId: null, activeThreadTitle: null, activeThreadCreatedAt: 0,
    profiles: [], profilesStatus: "idle", profilesNote: null,
    activeProfileId: null, activePlaybookId: null,
    tools: [], toolsScope: "", toolsStatus: "idle", toolsNote: null,
    sessions: [], sessionsStatus: "idle", sessionsNote: null,
    cockpit: null, liveActivity: null,
  };
}

export function createAssistantController(
  update: (state: AssistantState) => void,
  options: AssistantControllerOptions = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const getBridge = () => options.bridge ?? detectShellBridge();
  let state: AssistantState = initialAssistantState(options.initialModel ?? "");
  let disposed = false, seq = 0, chatGen = 0, streamGen = 0, modelsGen = 0;
  let streamAbort: AbortController | undefined, modelsAbort: AbortController | undefined;

  const nextId = () => `asst-${++seq}`;
  const emit = (patch: Partial<AssistantState>) => {
    state = { ...state, ...patch };
    if (!disposed) update(state);
  };
  const patchMessage = (id: string, fn: (msg: AssistantMessage) => AssistantMessage, extra?: Partial<AssistantState>) =>
    emit({ ...extra, messages: state.messages.map((msg) => (msg.id === id ? fn(msg) : msg)) });
  const toWireHistory = (messages: AssistantMessage[]): AssistantWireMessage[] =>
    messages.filter((msg) => !msg.error && msg.text.trim().length > 0).map((msg) => ({ role: msg.role, text: msg.text }));

  const abortActiveStream = () => {
    chatGen++;
    streamGen++;
    streamAbort?.abort();
    streamAbort = undefined;
    return chatGen;
  };

  const workspace = createWorkspaceActions({
    fetcher,
    getBridge,
    getState: () => state,
    isDisposed: () => disposed,
    emit,
    abortActiveStream,
    isChatCurrent: (gen) => gen === chatGen,
    toWireHistory,
  });

  async function loadModels(): Promise<void> {
    if (disposed) return;
    const run = ++modelsGen;
    modelsAbort?.abort();
    const ctrl = (modelsAbort = new AbortController());
    emit({ modelsLoading: true });
    try {
      const models = await readModels(ctrl.signal, fetcher, getBridge());
      if (disposed || run !== modelsGen) return;
      const keep = state.selectedModel && models.some((m) => m.ref === state.selectedModel || m.id === state.selectedModel);
      emit({ models, selectedModel: keep ? state.selectedModel : (models[0]?.ref ?? ""), modelsLoading: false });
    } catch (error) {
      if (disposed || run !== modelsGen || ctrl.signal.aborted) return;
      emit({
        modelsLoading: false,
        error: error instanceof ApiError ? error.message : "Could not load models. Check the backend and retry.",
      });
    } finally {
      if (modelsAbort === ctrl) modelsAbort = undefined;
    }
  }

  async function loadWorkspace(): Promise<void> {
    if (!disposed) await Promise.all([workspace.loadThreads(), workspace.refreshInspector()]);
  }

  const selectModel = (model: string): void => { if (!disposed) emit({ selectedModel: model }); };
  const selectProfile = (id: string | null): void => {
    if (!disposed) emit({ activeProfileId: id, ...(id ? { activePlaybookId: null } : {}) });
  };
  const selectPlaybook = (id: string | null): void => {
    if (!disposed) emit({ activePlaybookId: id, ...(id ? { activeProfileId: null } : {}) });
  };

  function buildSystemPrompt(): string | undefined {
    const playbook = findPlaybook(state.activePlaybookId);
    const parts = [options.system?.trim(), playbook?.instructions].filter((p): p is string => Boolean(p));
    return parts.length ? parts.join("\n\n") : undefined;
  }

  async function sendMessage(rawPrompt: string): Promise<void> {
    if (disposed || state.streaming) return;
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const run = ++streamGen, activeChat = chatGen, now = Date.now();
    const activeProfile = state.activeProfileId
      ? state.profiles.find((p) => p.id === state.activeProfileId && p.enabled) ?? null
      : null;
    const userMsg: AssistantMessage = { id: nextId(), role: "user", text: prompt, createdAt: now };
    const assistantId = nextId();
    const assistantMsg: AssistantMessage = {
      id: assistantId, role: "assistant", text: "", createdAt: now,
      ...(activeProfile ? { profileName: activeProfile.name } : {}),
    };
    const wireMessages = [...toWireHistory(state.messages), { role: "user" as const, text: prompt }];

    emit({
      messages: [...state.messages, userMsg, assistantMsg],
      streaming: true,
      error: null,
      liveActivity: { label: activeProfile ? `Running ${activeProfile.name}...` : "Thinking...", state: "running", toolCount: 0 },
    });
    const ctrl = (streamAbort = new AbortController());
    const stale = () => disposed || run !== streamGen || activeChat !== chatGen || ctrl.signal.aborted;

    try {
      if (activeProfile) {
        const result = await runSavedProfile(
          { profileId: activeProfile.id, profileRevision: activeProfile.revision, prompt },
          ctrl.signal, fetcher, getBridge(),
        );
        if (stale()) return;
        const toolCalls: AssistantToolCall[] = result.toolCalls.map((call, idx) => ({
          id: `${result.runId}-tool-${idx}`, name: call.name, status: call.ok ? "done" : "error",
        }));
        patchMessage(
          assistantId,
          (m) => ({ ...m, text: result.text, ...(toolCalls.length ? { toolCalls } : {}) }),
          {
            streaming: false,
            liveActivity: {
              label: toolCalls.length ? `${activeProfile.name} completed (${toolCalls.length} tool calls)` : `${activeProfile.name} completed`,
              state: "done", toolCount: toolCalls.length,
            },
          },
        );
        workspace.persistCurrentThread(state.messages);
        return;
      }

      const system = buildSystemPrompt();
      let toolCount = 0;
      await streamAssistant(
        {
          messages: wireMessages,
          ...(state.selectedModel ? { model: state.selectedModel } : {}),
          ...(system ? { system } : {}),
        },
        {
          onText(chunk) { if (!stale()) patchMessage(assistantId, (m) => ({ ...m, text: m.text + chunk })); },
          onReasoning(chunk) { if (!stale()) patchMessage(assistantId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + chunk })); },
          onToolUse(tool) {
            if (stale()) return;
            toolCount++;
            patchMessage(
              assistantId,
              (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), { id: tool.id, name: tool.name, input: tool.input, status: "done" }] }),
              { liveActivity: { label: `Called ${tool.name}`, state: "running", toolName: tool.name, toolCount } },
            );
          },
          onError(message) {
            if (stale()) return;
            patchMessage(assistantId, (m) => ({ ...m, error: message }), {
              streaming: false, error: message, liveActivity: { label: "Turn failed", state: "error", toolCount },
            });
          },
          onDone() {
            if (stale()) return;
            emit({
              streaming: false,
              liveActivity: { label: toolCount > 0 ? `Completed (${toolCount} tool calls)` : "Response complete", state: "done", toolCount },
            });
            workspace.persistCurrentThread(state.messages);
          },
        },
        ctrl.signal, fetcher, getBridge(),
      );
    } catch (error) {
      if (stale()) return;
      const message = error instanceof ApiError ? error.message : "Could not reach Alfa Assistant. Check the backend and retry.";
      patchMessage(assistantId, (m) => ({ ...m, error: message }), {
        streaming: false, error: message, liveActivity: { label: "Turn failed", state: "error", toolCount: 0 },
      });
    } finally {
      if (streamAbort === ctrl) streamAbort = undefined;
      if (!stale() && state.streaming) emit({ streaming: false });
    }
  }

  function stopStreaming(): void {
    if (disposed || !state.streaming) return;
    streamGen++;
    streamAbort?.abort();
    streamAbort = undefined;
    const cleaned = state.messages.filter((m, idx) =>
      !(idx === state.messages.length - 1 && m.role === "assistant" && !m.text && !m.reasoning && !m.error),
    );
    emit({ messages: cleaned, streaming: false, liveActivity: null });
  }

  async function retryLast(): Promise<void> {
    if (disposed || state.streaming) return;
    let lastUserIdx = -1;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const prompt = state.messages[lastUserIdx].text;
    emit({ messages: state.messages.slice(0, lastUserIdx), error: null });
    await sendMessage(prompt);
  }

  function newChat(): void {
    if (disposed) return;
    abortActiveStream();
    emit({
      activeThreadId: null, activeThreadTitle: null, activeThreadCreatedAt: 0,
      messages: [], streaming: false, error: null, liveActivity: null,
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    chatGen++;
    streamGen++;
    modelsGen++;
    streamAbort?.abort();
    modelsAbort?.abort();
    streamAbort = undefined;
    modelsAbort = undefined;
    workspace.dispose();
  }

  return {
    loadModels, loadWorkspace, loadThreads: workspace.loadThreads, refreshInspector: workspace.refreshInspector,
    selectThread: workspace.selectThread, renameThread: workspace.renameThread, deleteThread: workspace.deleteThread,
    selectModel, selectProfile, selectPlaybook, sendMessage, stopStreaming, retryLast, newChat, dispose,
    getState: () => state,
  };
}
