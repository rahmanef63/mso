export const MCP_PROTOCOL_LATEST = "2026-07-28";
export const MCP_PROTOCOLS = [MCP_PROTOCOL_LATEST, "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export function negotiateMcpProtocol(requested?: string): string {
  return requested && (MCP_PROTOCOLS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_LATEST;
}
export function supportedMcpProtocol(value: string): boolean {
  return (MCP_PROTOCOLS as readonly string[]).includes(value);
}
