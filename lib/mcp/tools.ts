import { withWorkflowContext } from "./tool-context";
import { A2A_TOOLS } from "./tools-a2a";
import { AGENT_TOOLS } from "./tools-agent";
import { DISCOVERY_TOOLS } from "./tools-discovery";
import { FORGE_TOOLS } from "./tools-forge";
import { INFRA_TOOLS } from "./tools-infra";
import { INTEGRATION_TOOLS } from "./tools-integrations";
import { LEARNING_TOOLS } from "./tools-learning";
import { LOCAL_AGENT_TOOLS } from "./tools-local-agents";
import { OPERATOR_DASHBOARD_TOOLS } from "./tools-operator-dashboard";
import { POWER_TOOLS } from "./tools-power";
import { PROJECT_EXPERIENCE_TOOLS } from "./tools-project-experience";
import { PROJECT_MCP_TOOLS } from "./tools-project-mcp";
import { READ_TOOLS } from "./tools-read";
import { READ_PIPELINE_TOOLS } from "./tools-read-pipeline";
import { SESSION_ARTIFACT_TOOLS } from "./tools-session-artifacts";
import { SUBAGENT_TOOLS } from "./tools-subagents";
import { BLOCK_TOOLS, SURFACE_TOOLS } from "./tools-ui";

import type { McpTool } from "./tool-kit";
import { MUTATE_TOOLS } from "./tools-mutate";

export const TOOLS: McpTool[] = [...SESSION_ARTIFACT_TOOLS, ...READ_TOOLS, ...DISCOVERY_TOOLS, ...LEARNING_TOOLS, ...AGENT_TOOLS, ...LOCAL_AGENT_TOOLS, ...SUBAGENT_TOOLS, ...A2A_TOOLS, ...FORGE_TOOLS, ...READ_PIPELINE_TOOLS, ...PROJECT_MCP_TOOLS, ...PROJECT_EXPERIENCE_TOOLS, ...OPERATOR_DASHBOARD_TOOLS, ...BLOCK_TOOLS, ...SURFACE_TOOLS, ...INFRA_TOOLS, ...INTEGRATION_TOOLS, ...MUTATE_TOOLS, ...POWER_TOOLS].map(withWorkflowContext); export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
