// Compatibility facade. Workflow lifecycle/recipes are owned by lib/workflow;
// skill discovery consumes them but no longer owns their persistence.
export {
  startWorkflow,
  summarizeProjectContention,
  countActiveWorkflowsForProject,
  activeWorkflowForActor,
  recordWorkflowStep,
  cancelWorkflow,
  finishWorkflow,
  listLearnedRecipes,
  markRecipeUsed,
  resetWorkflowStoreCache as resetSkillMemoryCache,
  summarizeWorkflowQuality,
} from "@/lib/workflow";
export type {
  WorkflowStepState,
  WorkflowStep,
  ActiveWorkflow,
  WorkflowQuality,
  LearnedRecipe,
  FinishWorkflowResult,
  CancelWorkflowResult,
  RecipeAccess,
  ProjectContentionSummary,
} from "@/lib/workflow";
