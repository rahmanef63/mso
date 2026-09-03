import type { McpTool } from "./tool-kit";
import { PROJECT_STATE_TOOLS } from "./tools-project-state";
import { PROJECT_RUNTIME_TOOLS } from "./tools-project-runtime";

export const PROJECT_EXPERIENCE_TOOLS: McpTool[] = [
  ...PROJECT_STATE_TOOLS,
  ...PROJECT_RUNTIME_TOOLS,
];
