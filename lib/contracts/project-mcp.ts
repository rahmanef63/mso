/** Metadata returned by project discovery; credential values are never DTOs. */
export type PublicProjectMcpServer = {
  name: string;
  transport: "stdio" | "http";
  auth: "none" | "configured" | "oauth" | "integration";
};
