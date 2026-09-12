import type { McpContent } from "@/lib/contracts/mcp-content";
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
export function projectMcpResult(raw: unknown) {
  if (!object(raw) || !Array.isArray(raw.content)) throw new Error("downstream MCP returned an invalid CallToolResult");
  const content = raw.content.map((block): McpContent => {
    if (!object(block)) throw new Error("invalid downstream MCP content");
    if (block.type === "text" && typeof block.text === "string") return block as McpContent;
    if (["image", "audio"].includes(String(block.type)) && typeof block.data === "string" && typeof block.mimeType === "string") return block as McpContent;
    if (block.type === "resource_link" && typeof block.uri === "string" && typeof block.name === "string") return block as McpContent;
    if (block.type === "resource" && object(block.resource) && typeof block.resource.uri === "string" &&
      (typeof block.resource.text === "string" || typeof block.resource.blob === "string")) return block as McpContent;
    throw new Error("unsupported or malformed downstream MCP content");
  });
  return { content, isError: raw.isError === true, structuredContent: object(raw.structuredContent) ? raw.structuredContent : undefined,
    // Downstream UI origins cannot grant themselves access to MSO's trusted canvas.
    meta: object(raw._meta) ? { "mso/downstream": raw._meta } : undefined };
}
