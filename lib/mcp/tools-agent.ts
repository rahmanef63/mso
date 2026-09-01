import { forgetAgentMemory, readAgentMemory, rememberAgentMemory, type AgentMemoryDocument } from "@/lib/agent/memory-store";
import { appendAgentSessionEvent, getAgentSession, listAgentSessions, resumeAgentSession } from "@/lib/agent/session-store";
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
    description:
      "Return this MCP conversation's durable MSO session id and summary. Use the id when the user wants to refer back to this MSO session from a later ChatGPT conversation.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({}),
    run: async (_a, context) => {
      if (!context.sessionId) throw new Error("this MCP client did not establish an MSO session");
      const session = await getAgentSession(principal(context), context.sessionId);
      if (!session) throw new Error("current MSO session is no longer available");
      return {
        id: session.id,
        source: session.source,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        resumedFrom: session.resumedFrom,
      };
    },
  },
  {
    name: "agent_sessions_list",
    description:
      "List durable MSO sessions owned by this MCP client, newest first. Use this when the user asks to find, recall, continue, or resume an earlier MSO session.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({ limit: { type: "number", description: "How many sessions to return (1-100, default 20)." } }),
    run: (a, context) => listAgentSessions(principal(context), Math.max(1, Math.min(100, Number(a.limit) || 20))),
  },
  {
    name: "agent_session_resume",
    description:
      "Read the safe resume packet for one prior MSO session owned by this MCP client: session metadata, its frozen memory snapshot, and recent operational events. This resumes MSO operational context; it cannot recover ChatGPT's hidden conversation transcript.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({ session_id: { type: "string", description: "Exact MSO session id returned by agent_session_current or agent_sessions_list." } }, ["session_id"]),
    run: (a, context) => resumeAgentSession(principal(context), str(a, "session_id"), context.sessionId),
  },
  {
    name: "agent_session_note",
    description:
      "Attach one concise durable note to the current MSO session so a later resume has the important operational context. Do not store passwords, API keys, tokens, cookies, or other secrets.",
    scope: "write",
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "agent.session", targetArg: "note" },
    inputSchema: S({ note: { type: "string", description: "Concise non-secret note, max 500 characters." } }, ["note"]),
    run: async (a, context) => {
      if (!context.sessionId) throw new Error("this MCP client did not establish an MSO session");
      const note = str(a, "note").trim();
      if (note.length > 500) throw new Error("session note must be 500 characters or fewer");
      await appendAgentSessionEvent(principal(context), context.sessionId, { kind: "note", detail: note });
      return { ok: true, sessionId: context.sessionId };
    },
  },
  {
    name: "agent_memory_read",
    description:
      "Read this MCP client's persistent USER.md and MEMORY.md agent memory. Sessions capture a frozen snapshot at creation, matching Hermes-style stable per-session context.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({}),
    run: (_a, context) => readAgentMemory(principal(context)),
  },
  {
    name: "agent_memory_remember",
    description:
      "Create or replace one keyed entry in this MCP client's persistent USER.md or MEMORY.md. USER.md is for stable user preferences/profile; MEMORY.md is for learned environment/project conventions. Never store secrets.",
    scope: "write",
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "agent.memory", targetArg: "key" },
    inputSchema: S({
      document: { type: "string", enum: ["USER.md", "MEMORY.md"] },
      key: { type: "string", description: "Stable one-line entry key, 1-80 characters." },
      value: { type: "string", description: "Non-secret memory value." },
    }, ["document", "key", "value"]),
    run: (a, context) => rememberAgentMemory(principal(context), document(a), str(a, "key"), str(a, "value")),
  },
  {
    name: "agent_memory_forget",
    description: "Remove one keyed entry from this MCP client's persistent USER.md or MEMORY.md.",
    scope: "write",
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "agent.memory", targetArg: "key" },
    inputSchema: S({
      document: { type: "string", enum: ["USER.md", "MEMORY.md"] },
      key: { type: "string" },
    }, ["document", "key"]),
    run: (a, context) => forgetAgentMemory(principal(context), document(a), str(a, "key")),
  },
];
