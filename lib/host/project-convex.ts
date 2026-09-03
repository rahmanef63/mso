import { promises as fs } from "node:fs";
import path from "node:path";
import { callMcpServerTool, listMcpServerTools, type ProjectMcpTool } from "./project-mcp-client";
import type { ProjectMcpServer } from "./project-mcp-config";
import { detectProjectConvex } from "./project-experience";

const SAFE_DEPLOYMENT = /^(?:dev|prod|local|[A-Za-z0-9._-]+|dev\/[A-Za-z0-9._-]+)$/;
const READ_TOOLS = new Set(["status", "tables", "data", "runOneoffQuery", "functionSpec", "insights", "logs"]);
const WRITE_TOOLS = new Set(["run"]);
const ALL_TOOLS = new Set([...READ_TOOLS, ...WRITE_TOOLS]);

function safeDeployment(value?: string): string | undefined {
  if (!value) return undefined;
  if (!SAFE_DEPLOYMENT.test(value) || value.includes(":")) {
    throw new Error("deployment must stay inside the selected project (dev, prod, local, staging, or dev/<name>; cross-project selectors are refused)");
  }
  return value;
}

async function convexServer(projectPath: string, deployment?: string): Promise<ProjectMcpServer> {
  const detected = await detectProjectConvex(projectPath);
  if (!detected.detected) throw new Error("Convex is not detected in this project");
  const command = path.join(projectPath, "node_modules", ".bin", "convex");
  const stat = await fs.lstat(command).catch(() => null);
  if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) {
    throw new Error("local Convex CLI is unavailable; install project dependencies first so node_modules/.bin/convex exists");
  }
  const selected = safeDeployment(deployment);
  const args = ["mcp", "start", "--project-dir", projectPath];
  if (selected) args.push("--deployment", selected);
  return { name: "convex", transport: "stdio", command, args, cwd: projectPath, env: {}, headers: {}, oauthConfigured: false };
}

function sanitizeArgs(args: unknown): Record<string, unknown> {
  const source = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const clean = { ...source };
  // Convex documents that status(projectDir) can escape --project-dir. MSO owns the
  // selected project boundary, so callers can never override it through nested args.
  delete clean.projectDir;
  delete clean.project_dir;
  return clean;
}

export async function listProjectConvexTools(projectPath: string, deployment?: string): Promise<ProjectMcpTool[]> {
  const server = await convexServer(projectPath, deployment);
  const tools = await listMcpServerTools(server);
  return tools.filter((tool) => ALL_TOOLS.has(tool.name));
}

export async function callProjectConvexTool(projectPath: string, tool: string, args: unknown, deployment?: string): Promise<unknown> {
  if (!ALL_TOOLS.has(tool)) throw new Error(`unsupported Convex MCP tool: ${tool}`);
  const server = await convexServer(projectPath, deployment);
  return callMcpServerTool(server, tool, sanitizeArgs(args));
}

export const PROJECT_CONVEX_READ_TOOLS = READ_TOOLS;
export const PROJECT_CONVEX_WRITE_TOOLS = WRITE_TOOLS;
