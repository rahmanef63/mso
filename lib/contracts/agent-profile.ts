export const PROFILE_READ_TOOLS = [
  "vps_status", "fs_list", "fs_read", "fs_search", "fs_usage", "projects_list",
  "project_get", "project_candidate_search", "project_capabilities",
] as const;
/** `mso-readonly` is MSO's own HTTP model runtime; `acp-cli` drives an installed agent CLI. */
export type AgentProfileRuntime = "mso-readonly" | "acp-cli";
/** Which installed ACP driver + instance a profile runs against. */
export interface AgentProfileAcpRef {
  /** Driver kind id from `ACP_DRIVERS` (e.g. "opencode", "hermes"). */
  driver: string;
  /** Instance id. Absent means "spawn a fresh isolated instance for this run". */
  instance?: string;
}
export interface AgentProfileConfig {
  name: string;
  avatar: string;
  instructions: string;
  runtime: AgentProfileRuntime;
  model: { provider: string; model: string };
  tools: string[];
  /** Present only for `runtime: "acp-cli"`. Absent configs keep the old shape. */
  acp?: AgentProfileAcpRef;
}
export type AgentProfileAction = "create" | "edit" | "clone" | "default" | "enable" | "disable";
export interface AgentProfileRevision {
  revision: number;
  at: string;
  actor: string;
  action: AgentProfileAction;
  reason: string;
  config: AgentProfileConfig;
  enabled: boolean;
}
export interface AgentProfile {
  id: string;
  owner: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  config: AgentProfileConfig;
  clonedFrom?: { id: string; revision: number };
  history: AgentProfileRevision[];
}
export interface AgentProfileStore {
  version: 1;
  revision: number;
  defaultProfileId: string | null;
  profiles: AgentProfile[];
}
export interface AgentProfileCatalog {
  store: AgentProfileStore;
  selectedModel: AgentProfileConfig["model"];
  tools: Array<{ name: string; description: string }>;
}
export interface AgentProfileRunResult {
  runId: string;
  profileId: string;
  profileRevision: number;
  model: AgentProfileConfig["model"];
  status: "completed" | "partial";
  text: string;
  rounds: number;
  toolCalls: Array<{ name: string; ok: boolean }>;
}
