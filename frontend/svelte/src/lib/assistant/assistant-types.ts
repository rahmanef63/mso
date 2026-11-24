import type { AssistantModel, AssistantWireMessage } from "./assistant-api.ts";

export type EndpointStatus = "idle" | "loading" | "ready" | "restricted" | "offline";

export type AssistantToolCall = {
  id: string;
  name: string;
  input?: unknown;
  status: "running" | "done" | "error";
  detail?: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  error?: string;
  createdAt?: number;
  profileName?: string;
  toolCalls?: AssistantToolCall[];
};

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type ThreadRecord = ThreadSummary & {
  messages: AssistantMessage[];
  history: AssistantWireMessage[];
};

export type AgentProfileSummary = {
  id: string;
  revision: number;
  enabled: boolean;
  isDefault: boolean;
  name: string;
  avatar: string;
  instructions: string;
  runtime: string;
  model: { provider: string; model: string };
  tools: string[];
};

export type AgentProfileRunOutput = {
  runId: string;
  profileId: string;
  profileRevision: number;
  status: "completed" | "partial";
  text: string;
  rounds: number;
  toolCalls: Array<{ name: string; ok: boolean }>;
};

export type AgentToolInfo = {
  name: string;
  description: string;
  scope: string;
  approvalRequired: boolean;
};

export type AgentSessionSummary = {
  id: string;
  name?: string;
  source?: string;
  title?: string;
  updatedAt?: string | number;
  cwd?: string;
  estimatedTokens?: number;
  eventCount?: number;
};

export type CockpitSnapshot = {
  model?: { provider: string; model: string; tokenSaver?: string };
  projectCount: number;
  localAgentCount: number;
  legacyMemoryCount: number;
  activeSessions: number;
};

export type PlaybookPreset = {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  starters: string[];
};

export type LiveActivityRow = {
  label: string;
  state: "running" | "done" | "error";
  toolName?: string;
  toolCount: number;
};

export type DrawerTab = "profiles" | "playbooks" | "tools" | "sessions";

export type AssistantState = {
  models: AssistantModel[];
  modelsLoading: boolean;
  selectedModel: string;
  messages: AssistantMessage[];
  streaming: boolean;
  error: string | null;
  threads: ThreadSummary[];
  threadsStatus: EndpointStatus;
  threadsNote: string | null;
  activeThreadId: string | null;
  activeThreadTitle: string | null;
  activeThreadCreatedAt: number;
  profiles: AgentProfileSummary[];
  profilesStatus: EndpointStatus;
  profilesNote: string | null;
  activeProfileId: string | null;
  activePlaybookId: string | null;
  tools: AgentToolInfo[];
  toolsScope: string;
  toolsStatus: EndpointStatus;
  toolsNote: string | null;
  sessions: AgentSessionSummary[];
  sessionsStatus: EndpointStatus;
  sessionsNote: string | null;
  cockpit: CockpitSnapshot | null;
  liveActivity: LiveActivityRow | null;
};
