import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import {
  ApiError, readModels, streamAssistant,
  type AssistantModel, type AssistantWireMessage,
} from "./assistant-api.ts";

export type AssistantMessage = {
  id: string; role: "user" | "assistant"; text: string; reasoning?: string; error?: string;
};
export type AssistantState = {
  models: AssistantModel[]; modelsLoading: boolean; selectedModel: string;
  messages: AssistantMessage[]; streaming: boolean; error: string | null;
};
export type AssistantControllerOptions = {
  fetcher?: typeof fetch; bridge?: ShellBridge; initialModel?: string; system?: string;
};

export function initialAssistantState(initialModel = ""): AssistantState {
  return { models: [], modelsLoading: false, selectedModel: initialModel, messages: [], streaming: false, error: null };
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

  function selectModel(model: string): void {
    if (!disposed) emit({ selectedModel: model });
  }

  async function sendMessage(rawPrompt: string): Promise<void> {
    if (disposed || state.streaming) return;
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const run = ++streamGen, activeChat = chatGen;
    const userMsg: AssistantMessage = { id: nextId(), role: "user", text: prompt };
    const assistantId = nextId();
    const assistantMsg: AssistantMessage = { id: assistantId, role: "assistant", text: "" };
    const wireMessages = [...toWireHistory(state.messages), { role: "user" as const, text: prompt }];

    emit({ messages: [...state.messages, userMsg, assistantMsg], streaming: true, error: null });
    const ctrl = (streamAbort = new AbortController());
    const stale = () => disposed || run !== streamGen || activeChat !== chatGen || ctrl.signal.aborted;

    try {
      await streamAssistant(
        {
          messages: wireMessages,
          ...(state.selectedModel ? { model: state.selectedModel } : {}),
          ...(options.system ? { system: options.system } : {}),
        },
        {
          onText(chunk) { if (!stale()) patchMessage(assistantId, (m) => ({ ...m, text: m.text + chunk })); },
          onReasoning(chunk) { if (!stale()) patchMessage(assistantId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + chunk })); },
          onError(message) { if (!stale()) patchMessage(assistantId, (m) => ({ ...m, error: message }), { streaming: false, error: message }); },
          onDone() { if (!stale()) emit({ streaming: false }); },
        },
        ctrl.signal, fetcher, getBridge(),
      );
    } catch (error) {
      if (stale()) return;
      const message = error instanceof ApiError ? error.message : "Could not reach Alfa Assistant. Check the backend and retry.";
      patchMessage(assistantId, (m) => ({ ...m, error: message }), { streaming: false, error: message });
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
    emit({ messages: cleaned, streaming: false });
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
    chatGen++;
    streamGen++;
    streamAbort?.abort();
    streamAbort = undefined;
    emit({ messages: [], streaming: false, error: null });
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
  }

  return { loadModels, selectModel, sendMessage, stopStreaming, retryLast, newChat, dispose, getState: () => state };
}
