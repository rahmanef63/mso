import { randomToken } from "./pkce";
import { allows, type Scope } from "./scope";
import { storeToken, TOKEN_TTL_MS } from "./store";

export const MAX_SERVICE_TOKEN_TOOLS = 8;
export type ServiceTokenConstraints = Record<string, Record<string, string[]>>;

const SERVICE_TOKEN_TOOL_POLICY = {
  project_capabilities: { scope: "read" as const, constraintArgs: ["project"] as const },
  project_function_call: { scope: "exec" as const, constraintArgs: ["project", "name"] as const },
} as const;
type ServiceTokenTool = keyof typeof SERVICE_TOKEN_TOOL_POLICY;

export function normaliseServiceTokenTools(names: readonly string[], scope: Scope): string[] {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (!unique.length || unique.length > MAX_SERVICE_TOKEN_TOOLS) throw new Error(`service token needs 1..${MAX_SERVICE_TOKEN_TOOLS} allowed tools`);
  for (const name of unique) {
    const policy = SERVICE_TOKEN_TOOL_POLICY[name as ServiceTokenTool];
    if (!policy) throw new Error(`tool is not eligible for service tokens: ${name}`);
    if (!allows(scope, policy.scope)) throw new Error(`${name} needs ${policy.scope} scope`);
  }
  return unique;
}

export function normaliseServiceTokenConstraints(raw: unknown, allowedTools: readonly string[]): ServiceTokenConstraints | undefined {
  if (raw === undefined) throw new Error("service token constraints are required");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("service token constraints must be an object");
  const result: ServiceTokenConstraints = {};
  for (const [toolName, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedTools.includes(toolName)) throw new Error(`constraint tool is not allowlisted: ${toolName}`);
    const policy = SERVICE_TOKEN_TOOL_POLICY[toolName as ServiceTokenTool];
    if (!policy || !value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid constraints for ${toolName}`);
    const constraintArgs = new Set<string>(policy.constraintArgs);
    const row: Record<string, string[]> = {};
    for (const [key, allowedRaw] of Object.entries(value as Record<string, unknown>)) {
      if (!constraintArgs.has(key)) throw new Error(`unknown constrained argument: ${toolName}.${key}`);
      if (!Array.isArray(allowedRaw) || !allowedRaw.length || allowedRaw.length > 16 || allowedRaw.some((one) => typeof one !== "string" || !one.trim() || one.length > 160)) {
        throw new Error(`constraint ${toolName}.${key} needs 1..16 bounded string values`);
      }
      row[key] = [...new Set((allowedRaw as string[]).map((one) => one.trim()))];
    }
    if (!Object.keys(row).length) throw new Error(`constraints for ${toolName} are empty`);
    result[toolName] = row;
  }
  for (const toolName of allowedTools) {
    const policy = SERVICE_TOKEN_TOOL_POLICY[toolName as ServiceTokenTool];
    const row = result[toolName];
    if (!policy || !row) throw new Error(`service token needs exact constraints for ${toolName}`);
    for (const key of policy.constraintArgs) {
      if (!row[key]?.length) throw new Error(`service token needs exact constraint ${toolName}.${key}`);
    }
  }
  return result;
}

export async function issueServiceToken(input: { label: string; clientId: string; scope: Scope; allowedTools: readonly string[]; constraints?: unknown }) {
  const label = input.label.trim().slice(0, 80), clientId = input.clientId.trim().slice(0, 120);
  if (!label || !clientId) throw new Error("service token label and client id are required");
  const allowedTools = normaliseServiceTokenTools(input.allowedTools, input.scope);
  const toolArgumentConstraints = normaliseServiceTokenConstraints(input.constraints, allowedTools);
  const token = randomToken("mso_mcp_");
  const now = Date.now();
  await storeToken(token, { label, clientId, scope: input.scope, allowedTools, ...(toolArgumentConstraints ? { toolArgumentConstraints } : {}) });
  return { token, scope: input.scope, allowedTools, toolArgumentConstraints, expiresAt: now + TOKEN_TTL_MS };
}
