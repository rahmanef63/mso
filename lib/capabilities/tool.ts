import type { AuditAction } from "@/lib/contracts/audit";
import type { CapabilityRuntime } from "./runtime";
import type { Scope } from "./scope";

export type CapabilityToolProfile = "full" | "chatgpt";

export type CapabilityContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface CapabilityDirectResult {
  __mcpDirect: true;
  content: CapabilityContent[];
  isError?: boolean;
  /** Optional safe structured projection for transports that advertise an output schema.
   * Never put binary/base64 payloads or secrets here. */
  structuredContent?: Record<string, unknown>;
}

// UI-only capability data is deliberately not a property of the result. Generic
// JSON serialization, logs, Alfa, pipelines and model runtimes cannot copy it.
const PRIVATE_RESULT_META = new WeakMap<object, Record<string, unknown>>();
export const capabilityPrivateMeta = (result: object) => PRIVATE_RESULT_META.get(result);

/** Compatibility marker stays __mcpDirect until the public MCP result contract is versioned. */
export function capabilityDirect(
  content: CapabilityContent[],
  isError = false,
  structuredContent?: Record<string, unknown>,
  privateMeta?: Record<string, unknown>,
): CapabilityDirectResult {
  const result: CapabilityDirectResult = { __mcpDirect: true, content, ...(isError ? { isError: true } : {}), ...(structuredContent ? { structuredContent } : {}) };
  if (privateMeta) PRIVATE_RESULT_META.set(result, privateMeta);
  return result;
}

export function isCapabilityDirectResult(value: unknown): value is CapabilityDirectResult {
  return Boolean(value && typeof value === "object" && (value as CapabilityDirectResult).__mcpDirect === true);
}

export interface CapabilityRunContext {
  actor?: string;
  principal?: string;
  sessionId?: string;
  scope: Scope;
  workflowId?: string;
  workflowActor?: string;
  recipeActor?: string;
  capabilities?: CapabilityRuntime;
  toolProfile?: CapabilityToolProfile;
}

/**
 * Transport-neutral executable capability. MCP-specific metadata is kept as an
 * optional extension because MCP is one adapter over this catalog, not its owner.
 */
export interface CapabilityTool {
  name: string;
  title?: string;
  description: string;
  chatgptDescription?: string;
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  outputSchema?: Record<string, unknown>;
  toStructuredContent?: (result: unknown) => Record<string, unknown> | undefined;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; idempotentHint?: boolean };
  securitySchemes?: Array<{ type: "oauth2"; scopes: string[] } | { type: "noauth" }>;
  meta?: Record<string, unknown>;
  run: (args: Record<string, unknown>, context: CapabilityRunContext) => Promise<unknown>;
  audit?: {
    action: AuditAction;
    targetArg?: string;
    outcome?: (result: unknown) => { ok: boolean; action?: AuditAction; detail?: string };
  };
  result?: { maxTextBytes?: number; overflowHint?: string };
  limit?: { max: number; windowMs: number; keyArg?: string; key: string };
}

export const str = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
};
export const opt = (args: Record<string, unknown>, key: string): string | undefined =>
  typeof args[key] === "string" && args[key] ? (args[key] as string) : undefined;
export const S = (properties: Record<string, unknown>, required?: string[]) =>
  ({ type: "object" as const, properties, ...(required ? { required } : {}) });
export const PATH_P = { path: { type: "string", description: "Absolute path on the VPS, or ~/… for the owner's home." } };
export const READ_ONLY = { readOnlyHint: true, idempotentHint: true };
