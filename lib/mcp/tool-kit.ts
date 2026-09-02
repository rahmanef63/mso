// MCP compatibility aliases over the transport-neutral capability contract.
export {
  capabilityDirect as mcpDirect,
  isCapabilityDirectResult as isMcpDirectResult,
  str,
  opt,
  S,
  PATH_P,
  READ_ONLY,
} from "@/lib/capabilities/tool";
export type {
  CapabilityContent as McpContent,
  CapabilityDirectResult as McpDirectResult,
  CapabilityRunContext as McpRunContext,
  CapabilityTool as McpTool,
} from "@/lib/capabilities/tool";
