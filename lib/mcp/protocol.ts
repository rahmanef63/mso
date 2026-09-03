// MSO currently serves the initialize/session-era MCP wire contract.
// Do not advertise the 2026-07-28 stateless era until server/discover,
// per-request metadata and modern Streamable HTTP headers are implemented as
// one coherent transport. A modern HTTP client can probe 2026-07-28, receive
// an explicit 400 from app/mcp/route.ts, then fall back to this legacy ceiling.
export const MCP_PROTOCOL_LATEST = "2025-06-18";
export const MCP_PROTOCOLS = [MCP_PROTOCOL_LATEST, "2025-03-26", "2024-11-05"] as const;

export function negotiateMcpProtocol(requested?: string): string {
  return requested && (MCP_PROTOCOLS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_LATEST;
}
export function supportedMcpProtocol(value: string): boolean {
  return (MCP_PROTOCOLS as readonly string[]).includes(value);
}
