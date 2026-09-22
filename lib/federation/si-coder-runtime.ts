import os from "node:os";
import path from "node:path";
import { resolveManagedSc } from "@/lib/host/sc-managed";
import { callMcpServerTool, listMcpServerTools } from "@/lib/host/project-mcp-client";
import type { ProjectMcpServer } from "@/lib/host/project-mcp-config";
import { inspectScInstallation } from "@/lib/host/sc-installation.mjs";
import { validateFederationArguments } from "./security";

export type FederationExecutionScope = "read" | "write" | "exec";

const WRITE_FUNCTIONS = new Set([
  "sc.user.create","sc.user.duplicate","sc.user.rename","sc.user.default","sc.user.map","sc.user.unmap","sc.user.delete",
  "sc.user.connection.manage","sc.user.credential.request","sc.user.credential.delete",
  "sc.provider.create","sc.provider.update","sc.provider.delete","sc.provider.key-add","sc.provider.key-remove",
  "sc.memory.record","sc.evidence.record","sc.recipe.observe","sc.recipe.promote","sc.data.import","sc.hostinger.mail.mutate",
]);
const EXEC_FUNCTIONS = new Set(["sc.update", "sc.doku.mcp.call", "sc.flow.run"]);

export function siCoderFederationScope(name: string): FederationExecutionScope {
  if (EXEC_FUNCTIONS.has(name)) return "exec";
  if (WRITE_FUNCTIONS.has(name)) return "write";
  return "read";
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function validateSchema(schema: unknown, value: unknown, at: string): void {
  if (!object(schema)) return;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length) {
    const matches = types.some((type) => {
      if (type === "string") return typeof value === "string";
      if (type === "number") return typeof value === "number" && Number.isFinite(value);
      if (type === "integer") return typeof value === "number" && Number.isInteger(value);
      if (type === "boolean") return typeof value === "boolean";
      if (type === "object") return object(value);
      if (type === "array") return Array.isArray(value);
      if (type === "null") return value === null;
      return false;
    });
    if (!matches) throw new Error(`${at} has the wrong type`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    throw new Error(`${at} is not an allowed enum value`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) throw new Error(`${at} is too short`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) throw new Error(`${at} is too long`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) throw new Error(`${at} does not match the required pattern`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) throw new Error(`${at} is below minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum) throw new Error(`${at} is above maximum`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) throw new Error(`${at} has too few items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) throw new Error(`${at} has too many items`);
    if (schema.items) value.forEach((item, index) => validateSchema(schema.items, item, `${at}[${index}]`));
  }
  if (object(value)) {
    const properties = object(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${at}.${key} is required`);
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unknown) throw new Error(`${at}.${unknown} is not allowed`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) validateSchema(properties[key], item, `${at}.${key}`);
    }
  }
}

async function standaloneServer(cwd: string): Promise<Extract<ProjectMcpServer, { transport: "stdio" }>> {
  const managed = await resolveManagedSc({
    name: "si-coder",
    transport: "plugin",
    plugin: "si-coder",
    cwd,
    headers: {},
    oauthConfigured: false,
  });
  // The normal MSO project plugin intentionally exposes a reduced managed surface.
  // Federation needs the reviewed standalone manifest, but still uses the same
  // verified installation, executable and credential-safe SI-Coder process.
  const { consumer: _consumer, ...server } = managed;
  return server;
}

export async function inspectSiCoderFederationRuntime(cwd: string) {
  const installation = await inspectScInstallation(process.env.MSO_SC_BIN || path.join(os.homedir(), ".local", "bin", "sc"));
  const server = await standaloneServer(cwd);
  const tools = await listMcpServerTools(server);
  return {
    version: installation.version,
    functionCount: tools.length,
    tools,
  };
}

export async function executeSiCoderFederation(input: {
  cwd: string;
  operation: string;
  arguments: Record<string, unknown>;
  scope: FederationExecutionScope;
  confirmed: boolean;
}) {
  const args = validateFederationArguments(input.arguments);
  const expectedScope = siCoderFederationScope(input.operation);
  if (input.scope !== expectedScope) throw new Error(`SI-Coder scope mismatch: request=${input.scope}, runtime=${expectedScope}`);
  if (expectedScope !== "read" && !input.confirmed) throw new Error("SI-Coder write/exec federation requires explicit confirmation");

  const server = await standaloneServer(input.cwd);
  const tools = await listMcpServerTools(server);
  const tool = tools.find((candidate) => candidate.name === input.operation);
  if (!tool) throw new Error(`unknown SI-Coder federation function: ${input.operation}`);
  validateSchema(tool.inputSchema, args, "arguments");
  return callMcpServerTool(server, input.operation, args);
}
