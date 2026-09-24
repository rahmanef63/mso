import { resolveIntegrationVariable } from "@/lib/infra/connection-service";

export type JevIntegrationInput = {
  variable?: string;
  user?: string;
  connection?: string;
  tool?: string;
  model?: string;
};

export type JevIntegrationConfig = {
  user: string;
  connection: string;
  tool?: string;
  model?: string;
};

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("invalid Jev integration option");
  return value.trim();
}

export async function resolveJevIntegrationConfig(raw?: unknown): Promise<JevIntegrationConfig> {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const user = optionalText(input.user, 64);
  const connection = optionalText(input.connection, 64);
  const tool = optionalText(input.tool, 180);
  const model = optionalText(input.model, 180);
  if (user || connection) {
    if (!user || !connection) throw new Error("Jev override requires both integration user and connection");
    return { user, connection, ...(tool ? { tool } : {}), ...(model ? { model } : {}) };
  }
  const variable = optionalText(input.variable, 64) ?? "JEV";
  const ref = await resolveIntegrationVariable(variable);
  if (ref.provider !== "mcp") throw new Error(variable + " Integration Variable must reference provider mcp");
  return { user: ref.user, connection: ref.connection, ...(tool ? { tool } : {}), ...(model ? { model } : {}) };
}
