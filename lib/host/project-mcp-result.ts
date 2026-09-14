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
  return {
    content,
    isError: raw.isError === true,
    structuredContent: object(raw.structuredContent) ? raw.structuredContent : undefined,
    // Downstream UI origins cannot grant themselves access to MSO's trusted canvas.
    meta: object(raw._meta) ? { "mso/downstream": raw._meta } : undefined,
  };
}

export function projectMcpStructuredProjection(result: ReturnType<typeof projectMcpResult>) {
  const content = result.content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "resource_link") return { type: "resource_link", uri: block.uri, name: block.name };
    if (block.type === "resource") {
      const resource = block.resource;
      return {
        type: "resource",
        resource: {
          uri: resource.uri,
          ...(typeof resource.text === "string" ? { text: resource.text } : { binaryOmitted: true }),
          ...(typeof resource.mimeType === "string" ? { mimeType: resource.mimeType } : {}),
        },
      };
    }
    return { type: block.type, mimeType: block.mimeType, binaryOmitted: true };
  });
  return {
    content,
    ...(result.isError ? { isError: true } : {}),
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
  };
}
