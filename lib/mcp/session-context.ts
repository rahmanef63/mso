import { findOrCreateAgentSessionForConversation, getAgentSession } from "@/lib/agent/session-store";
import { newAgentSessionId } from "@/lib/agent/session-files";
import { conversationHash } from "@/lib/agent/session-policy";

const MCP_SESSION_HEADER = "Mcp-Session-Id";

type RpcLike = {
  id?: string | number | null;
  method?: string;
  _meta?: Record<string, unknown>;
  params?: { name?: string; _meta?: Record<string, unknown> };
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
  const modern = mcpClientMeta(rpc)["io.modelcontextprotocol/protocolVersion"] === "2026-07-28";
  const transportId = modern ? undefined : (req.headers.get(MCP_SESSION_HEADER) ?? "").trim() || undefined;
  if (rpc.method === "initialize") return { responseSessionId: newAgentSessionId(), conversationBound: false };
  if (rpc.method !== "tools/call") return { responseSessionId: transportId, conversationBound: false };

  const explicitMeta = mcpClientMeta(rpc)["mso/sessionId"], explicitHeader = req.headers.get("Mso-Session-Id");
  if (explicitMeta !== undefined || explicitHeader) {
    if (explicitMeta !== undefined && typeof explicitMeta !== "string" || explicitHeader && explicitMeta !== undefined && explicitHeader !== explicitMeta) return { response: errorResponse(rpc, 400, "conflicting or invalid MSO session id") };
    const id = (explicitMeta ?? explicitHeader) as string;
    const session = await getAgentSession(principal, id).catch(() => null);
    if (!session) return { response: errorResponse(rpc, 403, "MSO session not found for this principal") };
    return { responseSessionId: transportId, agentSessionId: session.id, conversationBound: true };
  }
  if (rpc.params?.name === "agent_session_open") return { responseSessionId: transportId, conversationBound: false };
  const generic = mcpClientMeta(rpc)["mso/conversationKey"];
  if (generic !== undefined) {
    if (typeof generic !== "string" || !generic.trim() || generic.length > 256) return { response: errorResponse(rpc, 400, "invalid mso/conversationKey") };
    const session = await findOrCreateAgentSessionForConversation(principal, conversationHash(principal, "agent:" + generic), "Agent · MSO");
    return { responseSessionId: transportId, agentSessionId: session.id, conversationBound: true };
  }
  const conversation = openAiSession(rpc);
  if (conversation) {
    const session = await findOrCreateAgentSessionForConversation(principal, conversationHash(principal, conversation), `ChatGPT · ${label || "MSO"}`);
    return { responseSessionId: transportId, agentSessionId: session.id, conversationBound: true };
  }

  if (!transportId) return { response: errorResponse(rpc, 400, "missing MSO session: call agent_session_open, then send params._meta[mso/sessionId]; ChatGPT metadata and legacy Mcp-Session-Id remain supported") };
  const legacyHash = conversationHash(principal, `legacy:${transportId}`);
  const session = await findOrCreateAgentSessionForConversation(principal, legacyHash, `MCP legacy · ${label || "MSO"}`);
  return { responseSessionId: transportId, agentSessionId: session.id, conversationBound: false };
}

export function mcpSessionHeaders(sessionId?: string): Record<string, string> {
  return { "Cache-Control": "no-store", ...(sessionId ? { [MCP_SESSION_HEADER]: sessionId } : {}) };
}
