import { listLocalAgents } from "@/lib/agent/local-agent-directory";
import { listLocalAgentInbox, updateLocalAgentMessageState } from "@/lib/agent/local-agent-mailbox";
import { replyLocalAgentMessage, sendLocalAgentMessage } from "@/lib/agent/local-agent-messaging";
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
    inputSchema: S({ include_offline: { type: "boolean", description: "Also include known sessions whose receive lease expired or explicitly ended. Default false." } }),
    run: async (a, context) => {
      const current = sessionContext(context);
      return listLocalAgents(current.principal, { currentSessionId: current.sessionId, includeOffline: a.include_offline === true });
    },
  },
  {
    name: "local_agent_message_send",
    description: "Send one explicit text message/task to another same-owner MSO session agent. Defaults to notify-only semantics, so it never causes a user-facing relay by itself. For a request that expects a later answer, set intent=request and requires_user_relay=true; the receiver should answer that exact request with local_agent_reply. No hidden transcript, memory, credentials, tool arguments, or extra permissions are copied.",
    scope: "write",
    limit: { key: "local-agent.send", max: 60, windowMs: 60_000 },
    audit: { action: "agent.message", targetArg: "target" },
    inputSchema: S({
      target: { type: "string", description: "Local label/name such as rahman, [rahman], agent-b, or exact durable session id." },
      message: { type: "string", description: "Explicit payload, maximum 16 KiB." },
      kind: { type: "string", enum: ["message", "task"], description: "message (default) or task." },
      intent: { type: "string", enum: ["notify", "request"], description: "notify (default) or request. Replies must use local_agent_reply." },
      requires_user_relay: { type: "boolean", description: "For request intent only: relay a correlated reply directly to the originating user-facing conversation." },
    }, ["target", "message"]),
    run: async (a, context) => {
      const current = sessionContext(context);
      return sendLocalAgentMessage({
        principal: current.principal,
        senderSessionId: current.sessionId,
        target: str(a, "target"),
        text: str(a, "message"),
        kind: typeof a.kind === "string" ? a.kind : undefined,
        intent: typeof a.intent === "string" ? a.intent : undefined,
        requiresUserRelay: a.requires_user_relay === true,
      });
    },
  },
  {
    name: "local_agent_reply",
    description: "Reply to one exact correlated local-agent request in this session's inbox. The original sender, correlation id, and user-relay requirement are inherited from the request, preventing replies from being attached to the wrong turn. Use this instead of local_agent_message_send when answering an inbox item with intent=request.",
    scope: "write",
    limit: { key: "local-agent.send", max: 60, windowMs: 60_000 },
    audit: { action: "agent.message", targetArg: "reply_to_message_id" },
    inputSchema: S({
      reply_to_message_id: { type: "string", description: "Exact localmsg_... id of the request being answered." },
      message: { type: "string", description: "Explicit reply, maximum 16 KiB." },
      kind: { type: "string", enum: ["message", "task"] },
    }, ["reply_to_message_id", "message"]),
    run: async (a, context) => {
      const current = sessionContext(context);
      return replyLocalAgentMessage({
        principal: current.principal,
        senderSessionId: current.sessionId,
        replyToMessageId: str(a, "reply_to_message_id"),
        text: str(a, "message"),
        kind: typeof a.kind === "string" ? a.kind : undefined,
      });
    },
  },
  {
    name: "local_agent_inbox",
    description: "Read durable local-agent messages for this exact session. Each item carries explicit intent/correlation metadata. If intent=request, answer it with local_agent_reply(reply_to_message_id=<item.id>, ...); do not invent correlation by parsing text. By default only unread items are returned.",
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
      const messages = await listLocalAgentInbox(current.principal, current.sessionId, { includeRead: a.include_read === true, limit: Number(a.limit) || 100 });
      if (a.acknowledge === true && messages.length)
        await updateLocalAgentMessageState(current.principal, current.sessionId, messages.map((row) => row.id), "read");
      return messages;
    },
  },
];
