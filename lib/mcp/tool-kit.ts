import type { AuditAction } from "@/lib/host";
import type { Scope } from "./scope";

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
  scope: Scope;
  workflowId?: string;
}

export interface McpTool {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** MCP Apps structured output contract. */
  outputSchema?: Record<string, unknown>;
  /** Optional projection for the structured result. Use this to keep the portable
   * text fallback backward compatible while exposing a smaller, explicitly safe
   * object to a widget. */
  toStructuredContent?: (result: unknown) => Record<string, unknown> | undefined;
  annotations?: Record<string, boolean>;
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
     *  "did not throw", which is a lie for anything that has an exit code.
     *  Only exec_run needs this — `setCamoufoxEnabled` throws, and the fs helpers
     *  throw, so the catch branch already records those correctly. Deliberately
     *  NOT a generic result→outcome mapper: one call site is not a pattern. */
    outcome?: (result: unknown) => { ok: boolean; action?: AuditAction; detail?: string };
  };
  /** Per-OPERATION rate limit, mirroring the one its /api/v1 route already applies.
   *
   *  The token bucket in app/mcp/route.ts is per TOKEN (120/min, 50,000/day) and says
   *  nothing about which tool was called, so an MCP client got the same allowance
   *  for `apps_power` as for `fs_list` — while the browser and the CLI hit
   *  `managed-app:<id>` at 12/min going through the route. That is a 10x gap on a
   *  daemon restart, available to a WRITE-scope token that holds no shell.
   *
   *  `keyArg` puts the bucket on the same key the route uses, so MCP and the UI
   *  share it rather than getting one each. Numbers here must MATCH the route's,
   *  never undercut them — the route is the authority. */
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
export const READ_ONLY = { readOnlyHint: true, idempotentHint: true };
