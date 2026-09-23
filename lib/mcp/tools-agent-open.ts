import { randomUUID } from "node:crypto";
import { agentSessionSummary, findOrCreateAgentSessionForConversation, renameAgentSession, updateAgentSessionLocation } from "@/lib/agent/session-store";
import { conversationHash } from "@/lib/agent/session-policy";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { type McpTool, S, str } from "./tool-kit";

export const AGENT_OPEN_TOOLS: McpTool[] = [{
  name: "agent_session_open", title: "Open Agent Session", scope: "read",
  description: "Bootstrap an MSO application session for any AI provider. Reuse a unique conversation_key per conversation; this is metadata, never a secret. Send returned session.id as params._meta[mso/sessionId] or Mso-Session-Id on later calls. Optional exact project binds its working directory. The session is isolated to the authenticated principal.",
  chatgptDescription: "Open/resume a provider-neutral session using a stable conversation_key. Send session.id as _meta[mso/sessionId] on later calls.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  limit: { key: "agent.session.open", max: 20, windowMs: 60_000 },
  inputSchema: S({
    conversation_key: { type: "string", minLength: 1, maxLength: 256, description: "Optional stable identifier for this conversation. If omitted, a fresh session key is generated." },
    title: { type: "string", maxLength: 120, description: "Optional session title." },
    project: { type: "string", description: "Optional exact project id/path/name." },
  }),
  run: async (a, context) => {
    if (!context.principal) throw new Error("authenticated principal required");
    const rawKey = a.conversation_key ? str(a, "conversation_key") : `open:${randomUUID().slice(0, 16)}`;
    const key = rawKey.trim();
    if (!key || key.length > 256 || /[\x00-\x1f]/.test(key)) throw new Error("invalid conversation_key");
    const project = a.project ? await resolveProjectHint(str(a, "project")) : null;
    if (a.project && (!project || project.matchedBy === "fuzzy")) throw new Error("exact project required");
    const rawTitle = a.title ? str(a, "title").trim().slice(0, 120) : "";
    const sessionTitle = rawTitle || "Agent · MSO";
    let session = await findOrCreateAgentSessionForConversation(context.principal, conversationHash(context.principal, "agent:" + key), sessionTitle);
    if (rawTitle && session.title !== rawTitle) {
      session = await renameAgentSession(context.principal, session.id, rawTitle);
    }
    if (project && session.cwd !== project.path) session = await updateAgentSessionLocation(context.principal, session.id, project.path);
    return {
      ok: true,
      sessionId: session.id,
      title: session.title,
      session: agentSessionSummary(session),
      ...(project ? { project: project.id } : {}),
      next: { meta: { "mso/sessionId": session.id }, flow: "flow_catalog → flow_run → flow_status", projectMcp: "project_capabilities → project_mcp_tools → project_mcp_call" },
    };
  },
}];
