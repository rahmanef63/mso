import type { McpTool } from "./tool-kit";

const WORKFLOW_CONTEXT_EXEMPT = new Set([
  "skills_search", "workflow_start", "workflow_status", "workflow_cancel", "workflow_finish",
]);

export const withWorkflowContext = (tool: McpTool): McpTool => WORKFLOW_CONTEXT_EXEMPT.has(tool.name) ? tool : ({
  ...tool,
  inputSchema: {
    ...tool.inputSchema,
    properties: {
      ...tool.inputSchema.properties,
      workflow_id: {
        type: "string",
        description: "Exact id returned by workflow_start. Include it on every operational step in that run; omit it for a standalone call.",
      },
    },
  },
});
