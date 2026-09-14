/** Metadata returned by project discovery; credential values are never DTOs. */
export type ProjectPluginId = "si-coder" | "batonly";

export type PublicProjectMcpServer = {
  name: string;
  plugin?: ProjectPluginId;
  credentialAuthority?: "mso";
  transport: "stdio" | "http";
  auth: "none" | "configured" | "oauth" | "integration";
};

export type ProjectMcpTool = { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; outputSchema?: unknown; annotations?: unknown; icons?: unknown; execution?: unknown; _meta?: unknown };
