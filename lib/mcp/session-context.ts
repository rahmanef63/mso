import { findOrCreateAgentSessionForConversation } from "@/lib/agent/session-store";
import { newAgentSessionId } from "@/lib/agent/session-files";
import { conversationHash } from "@/lib/agent/session-policy";

const MCP_SESSION_HEADER = "Mcp-Session-Id";

type RpcLike = {
  id?: string | number | null;
  method?: string;
  _meta?: Record<string, unknown>;
  params?: { _meta?: Record<string, unknown> };
};

export interface ResolvedMcpSession {
  responseSessionId?: string;
  agentSessionId?: string;
  conversationBound: boolean;
}

export function mcpClientMeta(rpc: RpcLike): Record<string, unknown> {
  return { ...(rpc._meta ?? {}), ...(rpc.params?._meta ?? {}) };
}

function openAiSession(rpc: RpcLike): string | undefined {
  const value = mcpClientMeta(rpc)["openai/session"];
  return typeof value === "string" && value.length > 0 && value.length <= 1024 ? value : undefined;
}

function errorResponse(rpc: RpcLike, status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32600, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function resolveMcpSession(req: Request, rpc: RpcLike, principal: string, label: string): Promise<ResolvedMcpSession | { response: Response }> {
  const transportId = (req.headers.get(MCP_SESSION_HEADER) ?? "").trim() || undefined;
  if (rpc.method === "initialize") return { responseSessionId: newAgentSessionId(), conversationBound: false };
  if (rpc.method !== "tools/call") return { responseSessionId: transportId, conversationBound: false };

  const conversation = openAiSession(rpc);
  if (conversation) {
    const session = await findOrCreateAgentSessionForConversation(principal, conversationHash(principal, conversation), `ChatGPT · ${label || "MSO"}`);
    return { responseSessionId: transportId, agentSessionId: session.id, conversationBound: true };
  }

  if (!transportId) return { response: errorResponse(rpc, 400, "missing ChatGPT conversation metadata or legacy MCP session id") };
  const legacyHash = conversationHash(principal, `legacy:${transportId}`);
  const session = await findOrCreateAgentSessionForConversation(principal, legacyHash, `MCP legacy · ${label || "MSO"}`);
  return { responseSessionId: transportId, agentSessionId: session.id, conversationBound: false };
}

export function mcpSessionHeaders(sessionId?: string): Record<string, string> {
  return { "Cache-Control": "no-store", ...(sessionId ? { [MCP_SESSION_HEADER]: sessionId } : {}) };
}
