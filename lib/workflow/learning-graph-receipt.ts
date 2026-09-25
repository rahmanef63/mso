import path from "node:path";
import { ensureLearnedWorkflowGraph, workflowGraphOwner } from "./graph-store";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { readWorkflowJson, writeWorkflowFile } from "./private-file";
import type { FinishWorkflowResult, LearnedRecipe } from "./types";

type Receipt = NonNullable<FinishWorkflowResult["graphReceipt"]>;
function receiptFile(recipe: Pick<LearnedRecipe, "id" | "actor">) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(recipe.id)) throw new Error("invalid recipe id");
  return path.join(agentSessionsDir(), ".learning-receipts", workflowGraphOwner(recipe.actor), `${recipe.id}.json`);
}
export async function readLearningGraphReceipt(recipe: Pick<LearnedRecipe, "id" | "actor">): Promise<Receipt | null> {
  try {
    const row = await readWorkflowJson(receiptFile(recipe), 8192, "learning graph receipt") as Receipt;
    if (!["available", "skipped", "warning"].includes(row.state)) throw new Error("invalid learning graph receipt");
    return row;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function learnedGraphReceipt(recipe: LearnedRecipe): Promise<Receipt> {
  let receipt: Receipt;
  try {
    const graph = await ensureLearnedWorkflowGraph(recipe);
    receipt = graph ? { state: "available", graphId: graph.id } : { state: "skipped" };
  } catch (error) {
    receipt = { state: "warning", warning: error instanceof Error && error.message.startsWith("workflow_graph_capacity_reached")
      ? error.message : "Learned graph persistence failed; recipe retained. Inspect Workflows before retrying." };
  }
  try { await writeWorkflowFile(receiptFile(recipe), JSON.stringify({ ...receipt, updatedAt: new Date().toISOString() })); }
  catch { receipt = { ...receipt, state: "warning", warning: `${receipt.warning ?? "Graph processed."} Receipt persistence failed; this result is not durably recorded.` }; }
  return receipt;
}
