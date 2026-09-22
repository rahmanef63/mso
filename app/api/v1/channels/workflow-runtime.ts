import type { ChannelWorkflowRuntime } from "@/lib/channels/workflow";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { maxScope } from "@/lib/mcp/scope";
import { TOOLS_BY_NAME } from "@/lib/mcp/tools";

export function channelWorkflowRuntime(): ChannelWorkflowRuntime {
  return {
    scope: maxScope(),
    capabilities: msoCapabilityRuntime,
    resolveTool: (name) => TOOLS_BY_NAME.get(name),
  };
}
