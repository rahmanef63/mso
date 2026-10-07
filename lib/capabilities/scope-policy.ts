import { SCOPES, type Scope } from "./scope";

/** Deployment ceiling shared by transports and unattended workflow execution. */
export function configuredCapabilityCeiling(): Scope {
  const raw = process.env.OS_MCP_MAX_SCOPE;
  if (!raw) return "exec";
  const scope = raw.trim();
  return (SCOPES as readonly string[]).includes(scope) ? scope as Scope : "write";
}
