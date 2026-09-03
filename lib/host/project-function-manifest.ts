// SERVER-ONLY. Opt-in capability metadata declared BY a project, not features
// baked into MSO. Every file read is bounded/O_NOFOLLOW; MCP config contents are
// never returned because they commonly contain credential wiring.
import { promises as fs } from "fs";
import path from "path";
import { BOUNDED_READ, readBoundedRegularFile } from "./bounded-read";
import { isUnderRoot } from "./paths";

export const PROJECT_FUNCTIONS_REL = ".mso/functions.json" as const;
export const PROJECT_MCP_REL = ".mcp.json" as const;
const MAX_FUNCTIONS = 32;
const MAX_ARGV = 16;
const MAX_ARG = 512;
const MAX_DESCRIPTION = 600;
const DEFAULT_TIMEOUT_MS = 30_000;

export type ProjectFunction = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  command: string[];
  timeoutMs: number;
};

export type PublicProjectFunction = Omit<ProjectFunction, "command">;
export type ProjectCapabilities = {
  mcp?: { config: typeof PROJECT_MCP_REL; servers?: Array<{ name: string; transport: "stdio" | "http"; auth: "none" | "configured" | "oauth" }> };
  functions?:
    | { manifest: typeof PROJECT_FUNCTIONS_REL; valid: true; version: 1; count: number; tools: PublicProjectFunction[] }
    | { manifest: typeof PROJECT_FUNCTIONS_REL; valid: false; error: string };
};
export type ProjectFunctionsRead = { found: false } | { found: true; functions?: ProjectFunction[]; error?: string };

const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

async function projectMsoDir(projectPath: string): Promise<string | null> {
  const candidate = path.join(projectPath, ".mso");
  const stat = await fs.lstat(candidate).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
  const real = await fs.realpath(candidate).catch(() => null);
  return real && isUnderRoot(real, projectPath) && real === path.resolve(candidate) ? real : null;
}

function parseInputSchema(value: unknown, functionName: string): ProjectFunction["inputSchema"] {
  if (!plainObject(value) || value.type !== "object" || !plainObject(value.properties)) {
    throw new Error(`${functionName}: inputSchema must be an object JSON Schema`);
  }
  const required = value.required;
  if (required !== undefined && (!Array.isArray(required) || !required.every((item) => typeof item === "string"))) {
    throw new Error(`${functionName}: inputSchema.required must be a string array`);
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") {
    throw new Error(`${functionName}: inputSchema.additionalProperties must be boolean`);
  }
  return {
    type: "object",
    properties: value.properties,
    ...(required ? { required: [...new Set(required)] } : {}),
    ...(typeof value.additionalProperties === "boolean" ? { additionalProperties: value.additionalProperties } : {}),
  };
}

function parseManifest(raw: string): ProjectFunction[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("functions manifest is not valid JSON"); }
  if (!plainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.functions)) {
    throw new Error("functions manifest must be {version:1, functions:[…]}");
  }
  if (parsed.functions.length > MAX_FUNCTIONS) throw new Error(`functions manifest exceeds ${MAX_FUNCTIONS} functions`);
  const seen = new Set<string>();
  return parsed.functions.map((value, index): ProjectFunction => {
    if (!plainObject(value)) throw new Error(`functions[${index}] must be an object`);
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(name)) throw new Error(`functions[${index}].name is invalid`);
    if (seen.has(name)) throw new Error(`duplicate function name: ${name}`);
    seen.add(name);
    const description = typeof value.description === "string" ? value.description.trim() : "";
    if (!description || description.length > MAX_DESCRIPTION) throw new Error(`${name}: description must be 1-${MAX_DESCRIPTION} chars`);
    const command = Array.isArray(value.command) ? value.command : [];
    if (!command.length || command.length > MAX_ARGV || typeof command[0] !== "string" || command[0].length === 0 ||
        !command.every((arg) => typeof arg === "string" && arg.length <= MAX_ARG && !arg.includes("\0"))) {
      throw new Error(`${name}: command must have a non-empty executable plus at most ${MAX_ARGV - 1} fixed argv strings (max ${MAX_ARG} chars each)`);
    }
    const timeoutMs = value.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(value.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > DEFAULT_TIMEOUT_MS) {
      throw new Error(`${name}: timeoutMs must be 1000-${DEFAULT_TIMEOUT_MS}`);
    }
    return { name, description, inputSchema: parseInputSchema(value.inputSchema, name), command: [...command], timeoutMs };
  });
}

export async function readProjectFunctionsManifest(projectPath: string): Promise<ProjectFunctionsRead> {
  const mso = await projectMsoDir(projectPath);
  if (!mso) return { found: false };
  const file = path.join(mso, "functions.json");
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return { found: false };
  if (!stat.isFile() || stat.isSymbolicLink()) return { found: true, error: "functions manifest must be a regular non-symlink file" };
  const raw = await readBoundedRegularFile(file, BOUNDED_READ.projectFunctions);
  if (raw === null) return { found: true, error: `functions manifest is unreadable or exceeds ${BOUNDED_READ.projectFunctions} bytes` };
  try { return { found: true, functions: parseManifest(raw) }; }
  catch (error) { return { found: true, error: error instanceof Error ? error.message : "invalid functions manifest" }; }
}

async function hasMcpConfig(projectPath: string): Promise<boolean> {
  const file = path.join(projectPath, PROJECT_MCP_REL);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return false;
  const raw = await readBoundedRegularFile(file, BOUNDED_READ.projectMcpConfig);
  if (raw === null) return false;
  try { return plainObject(JSON.parse(raw)); } catch { return false; }
}

export async function projectCapabilities(projectPath: string): Promise<ProjectCapabilities | undefined> {
  const [mcp, fn] = await Promise.all([hasMcpConfig(projectPath), readProjectFunctionsManifest(projectPath)]);
  const capabilities: ProjectCapabilities = {};
  if (mcp) capabilities.mcp = { config: PROJECT_MCP_REL };
  if (fn.found) {
    capabilities.functions = fn.functions
      ? { manifest: PROJECT_FUNCTIONS_REL, valid: true, version: 1, count: fn.functions.length,
          tools: fn.functions.map(({ command: _command, ...tool }) => tool) }
      : { manifest: PROJECT_FUNCTIONS_REL, valid: false, error: fn.error ?? "invalid functions manifest" };
  }
  return capabilities.mcp || capabilities.functions ? capabilities : undefined;
}
