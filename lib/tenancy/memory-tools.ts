export const TENANT_MEMORY_TOOLS = ["agent_memory_read", "agent_memory_search", "agent_memory_remember", "agent_memory_forget"] as const;
export type TenantMemoryTool = typeof TENANT_MEMORY_TOOLS[number];
export class TenantMemoryInputError extends Error {}
export function tenantMemoryTool(value: string): value is TenantMemoryTool {
  return (TENANT_MEMORY_TOOLS as readonly string[]).includes(value);
}
const keys: Record<TenantMemoryTool, readonly string[]> = {
  agent_memory_read: [],
  agent_memory_search: ["query", "document", "kind", "at", "limit", "include_history"],
  agent_memory_remember: ["document", "key", "value", "kind", "confidence", "sensitivity", "valid_from", "valid_until", "mode"],
  agent_memory_forget: ["document", "key"],
};
export function validateMemoryArguments(tool: TenantMemoryTool, input: Record<string, unknown>) {
  const fail = (field: string): never => { throw new TenantMemoryInputError("invalid tenant memory " + field); };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("arguments");
  if (Object.keys(input).some(key => !keys[tool].includes(key))) fail("argument or routing selector");
  const a = { ...input };
  const option = (key: string, allowed: readonly unknown[]) => {
    if (a[key] !== undefined && !allowed.includes(a[key])) fail(key);
  };
  option("document", ["USER.md", "MEMORY.md"]); option("kind", ["semantic", "episodic", "procedural"]);
  option("sensitivity", ["normal", "private", "restricted"]); option("mode", ["replace", "claim"]);
  if (a.key !== undefined && (typeof a.key !== "string" || !/^[^\r\n\0]{1,80}$/.test(a.key.trim()) || a.key.trim().startsWith("#"))) fail("key");
  if (a.value !== undefined && (typeof a.value !== "string" || !a.value.trim() || Buffer.byteLength(a.value.trim()) > 8192)) fail("value");
  if (a.confidence !== undefined && (typeof a.confidence !== "number" || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1)) fail("confidence");
  for (const key of ["at", "valid_from", "valid_until"]) {
    if (a[key] !== undefined && (typeof a[key] !== "string" || a[key].length > 64 || !Number.isFinite(Date.parse(a[key])))) fail(key);
  }
  if (a.query !== undefined && (typeof a.query !== "string" || Buffer.byteLength(a.query) > 2048)) fail("query");
  if (a.limit !== undefined && (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 100)) fail("limit");
  if (a.include_history !== undefined && typeof a.include_history !== "boolean") fail("include_history");
  const required = tool === "agent_memory_remember" ? ["document", "key", "value"] : tool === "agent_memory_forget" ? ["document", "key"] : [];
  if (required.some(key => a[key] === undefined)) fail("required arguments");
  return Object.freeze(a);
}
