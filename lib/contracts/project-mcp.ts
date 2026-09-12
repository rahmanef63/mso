/** Metadata returned by project discovery; credential values are never DTOs. */
export type PublicProjectMcpServer = {
  name: string;
  transport: "stdio" | "http";
  auth: "none" | "configured" | "oauth" | "integration";
};

export type ProjectMcpTool = { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; outputSchema?: unknown; annotations?: unknown; icons?: unknown; execution?: unknown; _meta?: unknown };
