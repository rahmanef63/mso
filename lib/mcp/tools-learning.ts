import type { McpTool } from "./tool-kit";
import { PROJECT_MEMORY_TOOLS } from "./tools-project-memory";
import { WORKFLOW_LIFECYCLE_TOOLS } from "./tools-workflow-lifecycle";
import { WORKFLOW_START_TOOL } from "./tools-workflow-start";

export const LEARNING_TOOLS: McpTool[] = [WORKFLOW_START_TOOL, ...WORKFLOW_LIFECYCLE_TOOLS, ...PROJECT_MEMORY_TOOLS];
