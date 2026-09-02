// Internal compatibility module for the pre-split workflow store. Persistence is
// exclusively owned by storage.ts; lifecycle/contention/learning own behavior.
export { startWorkflow, activeWorkflowForActor, recordWorkflowStep, cancelWorkflow } from "./lifecycle";
export { summarizeProjectContention, countActiveWorkflowsForProject } from "./contention";
export { finishWorkflow, listLearnedRecipes, markRecipeUsed } from "./learning";
export { resetWorkflowStoreCache } from "./storage";
