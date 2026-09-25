import { ensureLearnedWorkflowGraph } from "./graph-store";
import type { FinishWorkflowResult, LearnedRecipe } from "./types";
export async function learnedGraphReceipt(recipe: LearnedRecipe): Promise<NonNullable<FinishWorkflowResult["graphReceipt"]>> {
  try {
    const graph = await ensureLearnedWorkflowGraph(recipe);
    return graph ? { state: "available", graphId: graph.id } : { state: "skipped" };
  } catch (error) {
    return { state: "warning", warning: error instanceof Error && error.message.startsWith("workflow_graph_capacity_reached")
      ? error.message : "Learned graph persistence failed; recipe retained. Inspect Workflows before retrying." };
  }
}
