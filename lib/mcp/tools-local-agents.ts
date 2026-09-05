import { listLocalAgents } from "@/lib/agent/local-agent-directory";
import { updateLocalAgentMessageState } from "@/lib/agent/local-agent-mailbox";
import { replyLocalAgentMessage, sendLocalAgentMessage, waitForLocalAgentInbox, waitForLocalAgentReply } from "@/lib/agent/local-agent-messaging";
import { handoffOwnerLocalSession } from "@/lib/a2a/local-session";
import { type McpRunContext, type McpTool, S, str } from "./tool-kit";

function sessionContext(context: McpRunContext): { principal: string; sessionId: string } {
  if (!context.principal || !context.sessionId)
    throw new Error("this tool call has no conversation-bound MSO session");
  return { principal: context.principal, sessionId: context.sessionId };
}

export const LOCAL_AGENT_TOOLS: McpTool[] = [
  {
    name: "local_agents_list",
    description: "List same-owner MSO session agents on this host. Every session has a short public name such as milo or luna for @mention UX. status reflects the presence lease; consumerConnected/consumerCount separately report whether this MSO runtime currently has an inbound receiver subscribed. No Agent Card, URL, registration, refresh, or restart is required.",
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
      target: { type: "string", description: "Local public name such as milo, [milo], legacy internal alias such as agent-b, or exact durable session id." },
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
    name: "local_agent_request",
    description: "Run an explicit objective against another same-owner durable MSO session and return its result. Unlike mailbox delivery, it works when that session's terminal receiver is offline: MSO starts a fresh bounded worker using the target session's saved context. It never wakes or controls a ChatGPT/terminal process, and it copies no hidden live transcript.",
    scope: "exec",
    limit: { key: "local-agent.request", max: 12, windowMs: 60_000 },
    audit: { action: "agent.message", targetArg: "target" },
    result: { maxTextBytes: 64 * 1024, overflowHint: "Local-agent result was compacted; rerun with a narrower objective." },
    inputSchema: S({
      target: { type: "string", description: "Same-owner durable session id, @name/name, title, or working-directory reference." },
      objective: { type: "string", description: "Explicit task for the target session worker, maximum 24 KiB." },
    }, ["target", "objective"]),
    run: async (a, context) => {
      const current = sessionContext(context);
      if (!context.capabilities) throw new Error("capability runtime unavailable for local-agent delegation");
      const result = await handoffOwnerLocalSession(current.principal, str(a, "target"), str(a, "objective"), context.capabilities, current.sessionId);
      return { mode: "durable_session_worker", ...result };
    },
  },
  {
    name: "local_agent_request_wait",
    description: "Wait a bounded foreground interval for the correlated reply to one exact request previously sent by this session. Returns replied, target_offline, consumer_absent, or timeout with current receiver observability. This never starts a background loop and never resends the request.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "local-agent.wait", max: 30, windowMs: 60_000 },
    inputSchema: S({
      request_message_id: { type: "string", description: "Exact localmsg_... id returned for the original request." },
      timeout_ms: { type: "number", minimum: 0, maximum: 30000, description: "Foreground wait budget in milliseconds. Default 5000; max 30000. Zero performs a status-only check." },
    }, ["request_message_id"]),
    run: async (a, context) => {
      const current = sessionContext(context);
      return waitForLocalAgentReply({
        principal: current.principal,
        senderSessionId: current.sessionId,
        requestMessageId: str(a, "request_message_id"),
        timeoutMs: a.timeout_ms === undefined ? undefined : Number(a.timeout_ms),
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
    description: "Read durable local-agent messages for this exact session. With wait_ms > 0, keep this foreground MCP call open for a bounded interval and return as soon as a peer message arrives; this uses the existing in-process receiver plus the durable mailbox, never a background loop. Each item carries explicit intent/correlation metadata. If intent=request, answer it with local_agent_reply(reply_to_message_id=<item.id>, ...); do not invent correlation by parsing text. By default only unread items are returned.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "local-agent.read", max: 120, windowMs: 60_000 },
    inputSchema: S({
      include_read: { type: "boolean" },
      limit: { type: "number", description: "1-200, default 100." },
      acknowledge: { type: "boolean", description: "When true, mark returned messages read after retrieval." },
      wait_ms: { type: "number", minimum: 0, maximum: 20000, description: "Optional foreground receive wait in milliseconds. Default 0 preserves immediate inbox reads; max 20000. Returns early when a peer message arrives." },
    }),
    run: async (a, context) => {
      const current = sessionContext(context);
      const messages = await waitForLocalAgentInbox({
        principal: current.principal,
        sessionId: current.sessionId,
        includeRead: a.include_read === true,
        limit: Number(a.limit) || 100,
        waitMs: a.wait_ms === undefined ? 0 : Number(a.wait_ms),
      });
      if (a.acknowledge === true && messages.length)
        await updateLocalAgentMessageState(current.principal, current.sessionId, messages.map((row) => row.id), "read");
      return messages;
    },
  },
];
