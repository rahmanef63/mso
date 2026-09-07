/** Exact endpoint binding prevents a repo edit from retargeting a stored token. */
export function normalizeMcpEndpoint(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("MCP endpoint must be an absolute HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("MCP endpoint must use HTTPS without credentials, query or fragment");
  }
  return url.href;
}

export function parseMcpToolAllowlist(raw?: string): string[] | null {
  if (!raw?.trim()) return null;
  const names = raw.split(",").map((value) => value.trim());
  if (names.length > 128 || names.some((name) => !/^[A-Za-z0-9_.-]{1,128}$/.test(name))) {
    throw new Error("MCP allowed tools must be exact comma-separated tool names (maximum 128)");
  }
  return [...new Set(names)];
}
