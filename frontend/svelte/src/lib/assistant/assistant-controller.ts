import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { ApiError, readModels, streamAssistant, type AssistantWireMessage } from "./assistant-api.ts";
import { runSavedProfile } from "./assistant-cockpit-api.ts";
import { findPlaybook } from "./assistant-presets.ts";
import type { AssistantMessage, AssistantState, AssistantToolCall } from "./assistant-types.ts";
import { createWorkspaceActions } from "./assistant-workspace.ts";
import { sendAssistantMessage, type SendContext } from "./assistant-send.ts";

export type { AssistantMessage, AssistantState };
export { initialAssistantState } from "./assistant-initial-state.ts";
import { initialAssistantState } from "./assistant-initial-state.ts";
export type AssistantControllerOptions = {
  fetcher?: typeof fetch;
  bridge?: ShellBridge;
  initialModel?: string;
  system?: string;
};

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

  const sendCtx: SendContext = {
    get state() { return state; },
    fetcher,
    getBridge,
    workspace,
    disposed: () => disposed,
    nextId,
    emit,
    patchMessage,
    toWireHistory,
    buildSystemPrompt: () => buildSystemPrompt(),
    beginStream: () => {
      const chat = abortActiveStream();
      const run = ++streamGen;
      return { run, chatGen, chat };
    },
    setStreamAbort: (ctrl) => { streamAbort = ctrl; },
    isStale: (run, chat, ctrl) => disposed || run !== streamGen || chat !== chatGen || ctrl.signal.aborted,
  };

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

  const sendMessage = async (rawPrompt: string): Promise<void> =>
    sendAssistantMessage(sendCtx, rawPrompt);

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
