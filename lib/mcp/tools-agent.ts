import { forgetAgentMemory, readAgentMemory, rememberAgentMemory, type AgentMemoryDocument } from "@/lib/agent/memory-store";
import { agentSessionSummary, appendAgentSessionEvent, getAgentSession, listAgentSessions, renameAgentSession, resumeAgentSession } from "@/lib/agent/session-store";
import { type McpTool, S, str } from "./tool-kit";

function principal(context: { principal?: string }): string {
  if (!context.principal) throw new Error("agent session principal is unavailable");
  return context.principal;
}
function document(a: Record<string, unknown>): AgentMemoryDocument {
  const value = str(a, "document");
  if (value !== "USER.md" && value !== "MEMORY.md") throw new Error("document must be USER.md or MEMORY.md");
  return value;
}

export const AGENT_TOOLS: McpTool[] = [
  {
    name: "agent_session_current",
    description: "Return this ChatGPT conversation's isolated durable MSO session, timestamps and estimated context-token budget.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true }, inputSchema: S({}),
    run: async (_a, context) => {
      if (!context.sessionId) throw new Error("this tool call has no conversation-bound MSO session");
      const session = await getAgentSession(principal(context), context.sessionId);
      if (!session) throw new Error("current MSO session is no longer available");
      return agentSessionSummary(session);
    },
  },
  {
    name: "agent_sessions_list",
    description: "List durable MSO sessions owned by this MCP client, newest first. Each ChatGPT conversation is a separate session.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({ limit: { type: "number", description: "How many sessions to return (1-100, default 20)." } }),
    run: (a, context) => listAgentSessions(principal(context), Math.max(1, Math.min(100, Number(a.limit) || 20))),
  },
  {
    name: "agent_session_resume",
    description: "Read the safe resume packet for one prior MSO session owned by this client. It returns summary/recent context, never ChatGPT hidden transcript.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({ session_id: { type: "string", description: "Exact MSO session id from agent_session_current/list." } }, ["session_id"]),
    run: (a, context) => resumeAgentSession(principal(context), str(a, "session_id"), context.sessionId),
  },
  {
    name: "agent_session_rename",
    description: "Manually rename the current MSO session. Manual names are locked and will not be replaced by automatic workflow-based naming.",
    scope: "write", limit: { key: "agent.session", max: 20, windowMs: 60_000 },
    audit: { action: "agent.session", targetArg: "title" },
    inputSchema: S({ title: { type: "string", description: "New session title, max 120 characters." } }, ["title"]),
    run: async (a, context) => {
      if (!context.sessionId) throw new Error("this tool call has no conversation-bound MSO session");
      return agentSessionSummary(await renameAgentSession(principal(context), context.sessionId, str(a, "title")));
    },
  },
  {
    name: "agent_session_note",
    description: "Attach one concise durable note to the current MSO session for later resume. Never store secrets.",
    scope: "write", limit: { key: "agent.session", max: 30, windowMs: 60_000 }, audit: { action: "agent.session", targetArg: "note" },
    inputSchema: S({ note: { type: "string", description: "Concise non-secret note, max 500 characters." } }, ["note"]),
    run: async (a, context) => {
      if (!context.sessionId) throw new Error("this tool call has no conversation-bound MSO session");
      const note = str(a, "note").trim(); if (note.length > 500) throw new Error("session note must be 500 characters or fewer");
      await appendAgentSessionEvent(principal(context), context.sessionId, { kind: "note", detail: note });
      return { ok: true, sessionId: context.sessionId };
    },
  },
  {
    name: "agent_memory_read",
    description: "Read this MCP client's persistent USER.md and MEMORY.md. New sessions capture a frozen snapshot.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true }, inputSchema: S({}),
    run: (_a, context) => readAgentMemory(principal(context)),
  },
  {
    name: "agent_memory_remember",
    description: "Create/replace a keyed entry in this MCP client's USER.md or MEMORY.md. Never store secrets.",
    scope: "write", limit: { key: "agent.memory", max: 30, windowMs: 60_000 }, audit: { action: "agent.memory", targetArg: "key" },
    inputSchema: S({ document: { type: "string", enum: ["USER.md", "MEMORY.md"] }, key: { type: "string" }, value: { type: "string" } }, ["document", "key", "value"]),
    run: (a, context) => rememberAgentMemory(principal(context), document(a), str(a, "key"), str(a, "value")),
  },
  {
    name: "agent_memory_forget",
    description: "Remove one keyed entry from this MCP client's USER.md or MEMORY.md.",
    scope: "write", limit: { key: "agent.memory", max: 30, windowMs: 60_000 }, audit: { action: "agent.memory", targetArg: "key" },
    inputSchema: S({ document: { type: "string", enum: ["USER.md", "MEMORY.md"] }, key: { type: "string" } }, ["document", "key"]),
    run: (a, context) => forgetAgentMemory(principal(context), document(a), str(a, "key")),
  },
];
