import { listLocalAgents } from "@/lib/agent/local-agent-directory";
import { listLocalAgentInbox, updateLocalAgentMessageState } from "@/lib/agent/local-agent-mailbox";
import { sendLocalAgentMessage } from "@/lib/agent/local-agent-messaging";
import { type McpRunContext, type McpTool, S, str } from "./tool-kit";

function sessionContext(context: McpRunContext): { principal: string; sessionId: string } {
  if (!context.principal || !context.sessionId)
    throw new Error("this tool call has no conversation-bound MSO session");
  return { principal: context.principal, sessionId: context.sessionId };
}

export const LOCAL_AGENT_TOOLS: McpTool[] = [
  {
    name: "local_agents_list",
    description: "List currently active same-owner MSO session agents on this host. Local agents are discovered automatically from live session leases; no Agent Card, URL, registration, refresh, or restart is required. Unnamed sessions use stable labels such as [agent-a].",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "local-agent.read", max: 60, windowMs: 60_000 },
    inputSchema: S({
      include_offline: { type: "boolean", description: "Also include known sessions whose receive lease expired or explicitly ended. Default false." },
    }),
    run: async (a, context) => {
      const current = sessionContext(context);
      return listLocalAgents(current.principal, {
        currentSessionId: current.sessionId,
        includeOffline: a.include_offline === true,
      });
    },
  },
  {
    name: "local_agent_message_send",
    description: "Send one explicit text message or task to another same-owner MSO session agent on this host. The payload is durable and bounded; no hidden transcript, memory, credentials, tool arguments, file data, or additional permissions are copied. Busy targets queue the message; offline known targets return target_offline and keep it for later delivery.",
    scope: "write",
    limit: { key: "local-agent.send", max: 60, windowMs: 60_000 },
    audit: { action: "agent.message", targetArg: "target" },
    inputSchema: S({
      target: { type: "string", description: "Active local label/name such as rahman, [rahman], agent-b, or an exact durable session id." },
      message: { type: "string", description: "Explicit payload, maximum 16 KiB. Known secret-shaped values are redacted before persistence/delivery." },
      kind: { type: "string", enum: ["message", "task"], description: "message (default) or task." },
    }, ["target", "message"]),
    run: async (a, context) => {
      const current = sessionContext(context);
      return sendLocalAgentMessage({
        principal: current.principal,
        senderSessionId: current.sessionId,
        target: str(a, "target"),
        text: str(a, "message"),
        kind: typeof a.kind === "string" ? a.kind : undefined,
      });
    },
  },
  {
    name: "local_agent_inbox",
    description: "Read durable local agent messages addressed to this exact MSO session. Messages are agent-origin events, not user messages. By default only unread/unacknowledged items are returned.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "local-agent.read", max: 120, windowMs: 60_000 },
    inputSchema: S({
      include_read: { type: "boolean" },
      limit: { type: "number", description: "1-200, default 100." },
      acknowledge: { type: "boolean", description: "When true, mark returned messages read after retrieval." },
    }),
    run: async (a, context) => {
      const current = sessionContext(context);
      const messages = await listLocalAgentInbox(current.principal, current.sessionId, {
        includeRead: a.include_read === true,
        limit: Number(a.limit) || 100,
      });
      if (a.acknowledge === true && messages.length)
        await updateLocalAgentMessageState(current.principal, current.sessionId, messages.map((row) => row.id), "read");
      return messages;
    },
  },
];
