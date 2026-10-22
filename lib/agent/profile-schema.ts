import { PROFILE_READ_TOOLS, type AgentProfileConfig, type AgentProfileStore } from "@/lib/contracts/agent-profile";

export class AgentProfileError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "AgentProfileError"; }
}
export function profilePrincipal(principal: string) {
  if (!/^web:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(principal)) throw new AgentProfileError("profile_owner_unsupported", 403);
  return principal;
}
export function profileObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentProfileError("profile_object_required");
  return raw as Record<string, unknown>;
}
export function profileFields(raw: Record<string, unknown>, fields: string[]) {
  if (Object.keys(raw).some(key => !fields.includes(key))) throw new AgentProfileError("unsupported_profile_field");
}
export function profileText(raw: unknown, field: string, max: number, empty = false): string {
  if (typeof raw !== "string" || raw.length > max || (!empty && !raw.trim()) || raw.includes("\0")) throw new AgentProfileError(`invalid_profile_${field}`);
  return raw.trim();
}
export function profileRevision(raw: unknown, zero = false): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < (zero ? 0 : 1)) throw new AgentProfileError("invalid_profile_revision");
  return raw;
}
export function parseProfileConfig(input: unknown): AgentProfileConfig {
  const raw = profileObject(input);
  profileFields(raw, ["name", "avatar", "instructions", "model", "runtime", "tools", "acp"]);
  // `mso-readonly` stays accepted verbatim; `acp-cli` hands the turn to an installed
  // agent CLI over the Agent Client Protocol. Anything else is still unsupported.
  if (raw.runtime !== "mso-readonly" && raw.runtime !== "acp-cli") throw new AgentProfileError("profile_runtime_unsupported", 422);
  // An ACP profile must name its driver: the runtime cannot guess which CLI to drive.
  if (raw.runtime === "acp-cli" && raw.acp === undefined) throw new AgentProfileError("profile_acp_required", 422);
  const acp = raw.runtime === "acp-cli" ? parseProfileAcp(raw.acp) : undefined;
  if (acp === undefined && raw.acp !== undefined) throw new AgentProfileError("unsupported_profile_field");
  const model = profileObject(raw.model); profileFields(model, ["provider", "model"]);
  const provider = profileText(model.provider, "provider", 64), modelId = profileText(model.model, "model", 200);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider) || ["constructor", "prototype"].includes(provider) || /\s/.test(modelId)) throw new AgentProfileError("invalid_profile_model");
  if (!Array.isArray(raw.tools) || raw.tools.length > PROFILE_READ_TOOLS.length || new Set(raw.tools).size !== raw.tools.length) throw new AgentProfileError("invalid_profile_tools");
  if (raw.tools.some((name) => !(PROFILE_READ_TOOLS as readonly unknown[]).includes(name))) throw new AgentProfileError("profile_tool_unsupported", 422);
  // An ACP agent owns its own tools; MSO must not also promise saved read tools.
  if (acp && raw.tools.length) throw new AgentProfileError("profile_tool_unsupported", 422);
  return { name: profileText(raw.name, "name", 80), avatar: profileText(raw.avatar ?? "", "avatar", 8, true),
    instructions: profileText(raw.instructions ?? "", "instructions", 4000, true),
    runtime: acp ? "acp-cli" : "mso-readonly", model: { provider, model: modelId }, tools: [...raw.tools],
    ...(acp ? { acp } : {}) };
}
function parseProfileAcp(input: unknown): NonNullable<AgentProfileConfig["acp"]> {
  const raw = profileObject(input);
  profileFields(raw, ["driver", "instance"]);
  const driver = profileText(raw.driver, "acp_driver", 64);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(driver)) throw new AgentProfileError("invalid_profile_acp_driver");
  if (raw.instance === undefined) return { driver };
  const instance = profileText(raw.instance, "acp_instance", 80);
  if (!/^acp_[A-Za-z0-9_-]{1,72}$/.test(instance)) throw new AgentProfileError("invalid_profile_acp_instance");
  return { driver, instance };
}
export function emptyProfileStore(): AgentProfileStore { return { version: 1, revision: 0, defaultProfileId: null, profiles: [] }; }
export function validateProfileStore(input: unknown, owner: string): AgentProfileStore {
  const raw = profileObject(input) as unknown as AgentProfileStore;
  profileFields(raw as unknown as Record<string, unknown>, ["version", "revision", "defaultProfileId", "profiles"]);
  if (raw.version !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length > 100) throw new AgentProfileError("invalid_profile_store", 500);
  profileRevision(raw.revision, true); profilePrincipal(owner);
  const ids = new Set<string>();
  for (const row of raw.profiles) {
    if (!row || !/^profile_[a-f0-9-]{36}$/.test(row.id) || ids.has(row.id) || row.owner !== owner || typeof row.enabled !== "boolean") throw new AgentProfileError("invalid_profile_record", 500);
    profileFields(row as unknown as Record<string, unknown>, ["id", "owner", "revision", "createdAt", "updatedAt", "enabled", "config", "clonedFrom", "history"]);
    ids.add(row.id); profileRevision(row.revision);
    if (!Array.isArray(row.history) || row.history.length !== row.revision || row.history.length > 200) throw new AgentProfileError("invalid_profile_history", 500);
    for (const [index, item] of row.history.entries()) {
      if (!item || item.revision !== index + 1 || item.actor !== owner || typeof item.at !== "string" || !Number.isFinite(Date.parse(item.at)) || typeof item.enabled !== "boolean" || !["create", "edit", "clone", "default", "enable", "disable"].includes(item.action)) throw new AgentProfileError("invalid_profile_history", 500);
      profileFields(item as unknown as Record<string, unknown>, ["revision", "at", "actor", "action", "reason", "config", "enabled"]);
      profileText(item.reason, "reason", 400); parseProfileConfig(item.config);
    }
    const last = row.history.at(-1)!;
    if (JSON.stringify(parseProfileConfig(row.config)) !== JSON.stringify(last.config) || last.enabled !== row.enabled || row.updatedAt !== last.at || row.createdAt !== row.history[0].at) throw new AgentProfileError("invalid_profile_head", 500);
    if (row.clonedFrom) {
      profileFields(profileObject(row.clonedFrom), ["id", "revision"]);
      if (!/^profile_[a-f0-9-]{36}$/.test(row.clonedFrom.id)) throw new AgentProfileError("invalid_profile_clone", 500);
      profileRevision(row.clonedFrom.revision);
    }
  }
  if (raw.defaultProfileId !== null && !raw.profiles.some(row => row.id === raw.defaultProfileId && row.enabled)) throw new AgentProfileError("invalid_profile_default", 500);
  if (raw.profiles.reduce((sum, row) => sum + row.revision, 0) !== raw.revision) throw new AgentProfileError("invalid_profile_store_revision", 500);
  return raw;
}
