import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { validateFederationArguments, FEDERATION_WORKER_ID } from "@/lib/federation/security";
import { executeSiCoderFederation } from "@/lib/federation/si-coder-runtime";
import { msoCapabilityRuntime } from "../capability-runtime";
import { TOOLS_BY_NAME } from "../tools";
import { BATON_SERVER, type FederationRequest } from "./types";

const ACTOR = "federation:batonly";

function recursiveMsoRequest(operation: string, args: Record<string, unknown>): boolean {
  if (operation !== "project_mcp_call") return false;
  return typeof args.server === "string" && args.server === BATON_SERVER;
}

export async function executeMsoFederation(request: FederationRequest) {
  const args = validateFederationArguments(request.arguments ?? {});
  const tool = TOOLS_BY_NAME.get(request.operation);
  if (!tool) throw new Error(`unknown MSO federation tool: ${request.operation}`);
  if (tool.scope !== request.scope) {
    throw new Error(`MSO scope mismatch: request=${request.scope}, runtime=${tool.scope}`);
  }
  if (tool.scope !== "read" && !request.confirmed) {
    throw new Error("MSO write/exec federation requires explicit confirmation");
  }
  if (recursiveMsoRequest(request.operation, args)) {
    throw new Error("recursive Batonly project MCP federation is not allowed");
  }

  const outcome = await executeCapabilityCall({
    tool,
    args,
    scope: tool.scope,
    actor: ACTOR,
    context: {
      principal: FEDERATION_WORKER_ID,
      capabilities: msoCapabilityRuntime,
    },
  });
  if (outcome.kind === "protocol_error") throw new Error(`MSO invalid arguments: ${outcome.message}`);
  if (outcome.kind === "error") throw new Error(outcome.message);
  return outcome.result;
}

export async function executeFederationRequest(request: FederationRequest, cwd = process.cwd()) {
  if (request.scope !== "read" && !request.confirmed) {
    throw new Error("federation write/exec request is missing explicit confirmation");
  }
  const args = validateFederationArguments(request.arguments ?? {});
  return request.source === "mso"
    ? executeMsoFederation({ ...request, arguments: args })
    : executeSiCoderFederation({
        cwd,
        operation: request.operation,
        arguments: args,
        scope: request.scope,
        confirmed: request.confirmed,
      });
}

export const msoFederationToolCount = () => TOOLS_BY_NAME.size;
