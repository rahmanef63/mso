import { agentSessionSummary, findOrCreateAgentSessionForConversation, updateAgentSessionLocation } from "@/lib/agent/session-store";
import { conversationHash } from "@/lib/agent/session-policy";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { type McpTool, S, str } from "./tool-kit";
export const AGENT_OPEN_TOOLS: McpTool[] = [{
  name: "agent_session_open", title: "Open Agent Session", scope: "write",
  description: "Bootstrap an MSO application session for any AI provider. Reuse a unique conversation_key per conversation; this is metadata, never a secret. Send returned session.id as params._meta[mso/sessionId] or Mso-Session-Id on later calls. Optional exact project binds its working directory. The session is isolated to the authenticated principal.",
  chatgptDescription: "Open/resume a provider-neutral session using a stable conversation_key. Send session.id as _meta[mso/sessionId] on later calls.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  audit: { action: "agent.session" }, limit: { key: "agent.session.open", max: 20, windowMs: 60_000 },
  inputSchema: S({ conversation_key: { type: "string", minLength: 1, maxLength: 256 }, project: { type: "string", description: "Optional exact project id/path/name." } }, ["conversation_key"]),
  run: async (a, context) => {
    if (!context.principal) throw new Error("authenticated principal required");
    const key = str(a, "conversation_key");
    if (!key.trim() || key.length > 256 || /[\x00-\x1f]/.test(key)) throw new Error("invalid conversation_key");
    const project = a.project ? await resolveProjectHint(str(a, "project")) : null;
    if (a.project && (!project || project.matchedBy === "fuzzy")) throw new Error("exact project required");
    let session = await findOrCreateAgentSessionForConversation(context.principal, conversationHash(context.principal, "agent:" + key), "Agent · MSO");
    if (project && session.cwd !== project.path) session = await updateAgentSessionLocation(context.principal, session.id, project.path);
    return { session: agentSessionSummary(session), ...(project ? { project: project.id } : {}),
      next: { meta: { "mso/sessionId": session.id }, flow: "flow_catalog → flow_run → flow_status", projectMcp: "project_capabilities → project_mcp_tools → project_mcp_call" } };
  },
}];
