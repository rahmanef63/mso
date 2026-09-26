import { loadWorkflowStore } from "./storage";
import type { WorkflowStep } from "./types";

export type WorkflowRecoveryCandidate = {
  sourceSessionId: string;
  intent: string;
  project?: string;
  constraints?: string;
  startedAt: string;
  lastActivityAt: string;
  stepCount: number;
  recentSteps: WorkflowStep[];
};

function normalizedProject(value?: string): string {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function projectAliases(values: string[]): Set<string> {
  const aliases = new Set<string>();
  for (const value of values) {
    const normalized = normalizedProject(value);
    if (!normalized) continue;
    aliases.add(normalized);
    const basename = normalized.split("/").filter(Boolean).at(-1);
    if (basename) aliases.add(basename);
  }
  return aliases;
}

function projectMatches(project: string | undefined, aliases: Set<string>): boolean {
  if (!aliases.size) return true;
  const normalized = normalizedProject(project);
  if (!normalized) return false;
  const basename = normalized.split("/").filter(Boolean).at(-1) ?? "";
  return aliases.has(normalized) || aliases.has(basename);
}

/**
 * Read-only crash recovery view of unfinished workflows for one stable principal.
 *
 * The returned rows deliberately omit the old workflow id/actor. A continuation
 * must start a fresh workflow in the new session instead of bypassing
 * conversation-scoped workflow isolation.
 */
export async function workflowRecoveryCandidates(input: {
  principal: string;
  projectRefs?: string[];
  excludeSessionId?: string;
  limit?: number;
}): Promise<WorkflowRecoveryCandidate[]> {
  const store = await loadWorkflowStore();
  const prefix = input.principal + "#session:";
  const aliases = projectAliases(input.projectRefs ?? []);
  const rows: WorkflowRecoveryCandidate[] = [];

  for (const [actor, workflows] of Object.entries(store.active)) {
    if (!actor.startsWith(prefix)) continue;
    const sourceSessionId = actor.slice(prefix.length);
    if (!sourceSessionId || sourceSessionId === input.excludeSessionId) continue;
    for (const workflow of Object.values(workflows)) {
      if (!projectMatches(workflow.project, aliases)) continue;
      const recentSteps = workflow.steps.slice(-12);
      const lastActivityAt = recentSteps.at(-1)?.ts ?? workflow.startedAt;
      rows.push({
        sourceSessionId,
        intent: workflow.intent,
        ...(workflow.project ? { project: workflow.project } : {}),
        ...(workflow.constraints ? { constraints: workflow.constraints } : {}),
        startedAt: workflow.startedAt,
        lastActivityAt,
        stepCount: workflow.steps.length,
        recentSteps,
      });
    }
  }

  rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return rows.slice(0, Math.max(1, Math.min(20, input.limit ?? 8)));
}
