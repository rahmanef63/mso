import type { AssistantState } from "./assistant-types.ts";

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
