/** MCP content blocks remain intact across broker transports. */
export type McpContent =
  | { type: "text"; text: string; annotations?: Record<string, unknown>; _meta?: Record<string, unknown> }
  | { type: "image" | "audio"; data: string; mimeType: string; annotations?: Record<string, unknown>; _meta?: Record<string, unknown> }
  | { type: "resource_link"; uri: string; name: string; description?: string; mimeType?: string; _meta?: Record<string, unknown> }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string }; _meta?: Record<string, unknown> };
