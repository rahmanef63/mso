import { parseBatonMcpResult } from "@/lib/federation/security";
import { callProjectMcpTool } from "@/lib/host/project-mcp-client";
import { readProjectMcpServers } from "@/lib/host/project-mcp-config";
import { resolveProjectHint } from "@/lib/host/projects";
import { BATON_SERVER, type BatonCall, type FederationRequest } from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export function asFederationRequest(value: unknown): FederationRequest {
  if (!object(value)) throw new Error("Batonly returned an invalid federation request");
  const source = value.source, scope = value.scope;
  if (source !== "mso" && source !== "si-coder") throw new Error("Batonly returned an unknown federation source");
  if (scope !== "read" && scope !== "write" && scope !== "exec") throw new Error("Batonly returned an invalid federation scope");
  if (typeof value.id !== "string" || typeof value.projectId !== "string" || typeof value.operation !== "string") {
    throw new Error("Batonly returned an incomplete federation request");
  }
  return {
    id: value.id,
    projectId: value.projectId,
    source,
    operation: value.operation,
    scope,
    confirmed: value.confirmed === true,
    status: typeof value.status === "string" ? value.status : "",
    arguments: object(value.arguments) ? value.arguments : undefined,
    attempts: typeof value.attempts === "number" ? value.attempts : undefined,
  };
}

function unwrapBaton(value: unknown): unknown {
  if (object(value) && value.isError === true) {
    const parsed = parseBatonMcpResult(value);
    throw new Error(`Batonly MCP refused federation request: ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  return parseBatonMcpResult(value);
}

export async function resolveBatonFederationProject() {
  const hint = (process.env.MSO_BATONLY_FEDERATION_PROJECT || "baton").trim();
  const project = await resolveProjectHint(hint);
  if (!project) throw new Error(`Batonly federation project is unavailable: ${hint}`);
  return project;
}

export async function batonFederationConfigured(): Promise<boolean> {
  const project = await resolveBatonFederationProject();
  const servers = await readProjectMcpServers(project.path);
  return servers.some((server) => server.name === BATON_SERVER);
}

export const defaultBatonCall: BatonCall = async (name, args) => {
  const project = await resolveBatonFederationProject();
  return unwrapBaton(await callProjectMcpTool(project.path, BATON_SERVER, name, args));
};
