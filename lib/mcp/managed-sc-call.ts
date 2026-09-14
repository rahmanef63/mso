import { readProjectMcpServers } from "@/lib/host/project-mcp-config";
import { managedScCall } from "@/lib/host/sc-consumer";
import { executeIntegrationAction, queryIntegrationAction } from "@/lib/infra/connection-dispatch";

/** Orchestrate two domains above the transport; neither domain imports the other. */
export async function callManagedScProvider(projectPath: string, serverName: string, name: string, args: unknown) {
  const server = (await readProjectMcpServers(projectPath)).find(row => row.name === serverName);
  if (server?.transport !== "plugin") return { handled: false as const };
  return managedScCall(name, args, (mode, input) => mode === "query" ? queryIntegrationAction(input) : executeIntegrationAction(input));
}
