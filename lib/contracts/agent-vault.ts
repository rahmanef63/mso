/** Portable data contract; repository identities and note bodies are installation data. */
export type AgentVaultKind = "overview" | "agent" | "project" | "progress" | "inbox" | "memory";
export interface AgentVaultNote {
  path: string;
  title: string;
  kind: AgentVaultKind;
  source: string;
}
export interface AgentVaultSnapshot {
  id: string;
  capturedAt: string;
  notes: AgentVaultNote[];
  warnings: string[];
  truncated: boolean;
}
export interface AgentVaultState {
  schemaVersion: 1;
  project: { id: string; name: string; path: string };
  root: string;
  current: string | null;
  snapshots: AgentVaultSnapshot[];
  refreshedAt: string | null;
}
export interface AgentVaultView {
  state: AgentVaultState;
  note?: { path: string; content: string };
}
