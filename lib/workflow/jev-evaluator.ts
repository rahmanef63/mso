import { createJevWorkflowOptimizerEvaluator } from "./jev-optimizer";
import { createOpenRouterJevWorkflowOptimizerEvaluator } from "./jev-openrouter";
import type { JevIntegrationConfig } from "./jev-integration";

export function createResolvedJevWorkflowOptimizerEvaluator(config: JevIntegrationConfig) {
  return config.transport === "openrouter"
    ? createOpenRouterJevWorkflowOptimizerEvaluator({ model: config.model })
    : createJevWorkflowOptimizerEvaluator(config);
}
