import type { AuditAction } from "@/lib/host";
import type { Scope } from "./scope";
import type { McpToolProfile } from "./tool-contract";

// Shared shapes for the MCP tool catalog. EVERY handler goes through lib/host — never node fs or
// child_process directly — so all of it inherits the bounds that already guard
// /api/v1: OS_FS_READ_ROOTS / OS_FS_WRITE_ROOTS, the credential denylist
// (~/.ssh, ~/.mso itself, cloud + AI tokens), realpath escape checks, and the
// catastrophic-command filter in exec.ts. That is the whole reason this file is
// thin: a tool that reimplemented an operation would reimplement its guard too.

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpDirectResult {
  __mcpDirect: true;
  content: McpContent[];
  isError?: boolean;
}

export function mcpDirect(content: McpContent[], isError = false): McpDirectResult {
  return { __mcpDirect: true, content, ...(isError ? { isError: true } : {}) };
}

export function isMcpDirectResult(value: unknown): value is McpDirectResult {
  return Boolean(value && typeof value === "object" && (value as McpDirectResult).__mcpDirect === true);
}

export interface McpRunContext {
  actor?: string;
  /** Stable principal for persistent agent session/memory ownership. Unlike the
   * token-scoped audit actor, this may survive an OAuth token refresh. */
  principal?: string;
  /** Durable Streamable HTTP / terminal-agent session id, when available. */
  sessionId?: string;
  scope: Scope;
  workflowId?: string;
  /** Session-scoped workflow owner; prevents cross-conversation workflow access. */
  workflowActor?: string;
  /** Client-scoped learned-recipe owner; survives individual session rotation. */
  recipeActor?: string;
  /** Client-specific static tool projection; project capabilities stay dynamic. */
  toolProfile?: McpToolProfile;
}

export interface McpTool {
  name: string;
  /** Human-readable label advertised to MCP hosts. Generated from name when omitted. */
  title?: string;
  description: string;
  /** Optional shorter description for the compact ChatGPT scan profile. */
  chatgptDescription?: string;
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** MCP Apps structured output contract. */
  outputSchema?: Record<string, unknown>;
  /** Optional projection for the structured result. Use this to keep the portable
   * text fallback backward compatible while exposing a smaller, explicitly safe
   * object to a widget. */
  toStructuredContent?: (result: unknown) => Record<string, unknown> | undefined;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; idempotentHint?: boolean };
  /** Per-tool auth policy advertised to MCP hosts. Defaults to OAuth with this tool's minimum MSO scope. */
  securitySchemes?: Array<{ type: "oauth2"; scopes: string[] } | { type: "noauth" }>;
  /** MCP Apps / OpenAI metadata: UI resource binding, visibility and file params. */
  meta?: Record<string, unknown>;
  run: (a: Record<string, unknown>, context: McpRunContext) => Promise<unknown>;
  /** Which audit action this writes, and which argument names the target. Reads
   *  are deliberately unaudited (bounded + high-volume, same rule the /api/v1
   *  routes follow); a tool without this field writes nothing.
   *
   *  This exists because MCP tools call lib/host DIRECTLY. The /api/v1 routes
   *  audit at the ROUTE layer, so without this every write, delete and exec that
   *  arrived over MCP would be invisible in the only forensic trail there is. */
  audit?: {
    action: AuditAction;
    targetArg?: string;
    /** Derive the outcome from the RESULT, for a handler that reports failure by
     *  returning rather than throwing. Without it the dispatcher can only record
     *  "did not throw", which is a lie for anything that has an exit code. */
    outcome?: (result: unknown) => { ok: boolean; action?: AuditAction; detail?: string };
  };
  /** Bound the generic model-visible text fallback without changing an explicit structured UI projection. */
  result?: { maxTextBytes?: number; overflowHint?: string };
  /** Per-operation rate limit, mirroring the one its /api/v1 route already applies. */
  limit?: { max: number; windowMs: number; keyArg?: string; key: string };
}

export const str = (a: Record<string, unknown>, k: string): string => {
  const v = a[k];
  if (typeof v !== "string" || !v) throw new Error(`${k} must be a non-empty string`);
  return v;
};
export const opt = (a: Record<string, unknown>, k: string): string | undefined =>
  typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined;

export const S = (properties: Record<string, unknown>, required?: string[]) =>
  ({ type: "object" as const, properties, ...(required ? { required } : {}) });

export const PATH_P = { path: { type: "string", description: "Absolute path on the VPS, or ~/… for the owner's home." } };
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
