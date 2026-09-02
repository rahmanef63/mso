import { pruneStaleWorkflows } from "./state";
import { loadWorkflowStore, persistWorkflowStore } from "./storage";
import type { ProjectContentionSummary } from "./types";

const normalizedProject = (value?: string) => value?.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() ?? "";
const pathScopeOverlaps = (a: string, b: string): boolean => {
  const left = a.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const right = b.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return Boolean(left && right && (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
};

export async function summarizeProjectContention(
  project?: string,
  affectedPaths: string[] = [],
  reservedResources: string[] = [],
): Promise<ProjectContentionSummary> {
  const key = normalizedProject(project);
  if (!key) return { activeWorkflowCount: 0, conflictingWorkflowCount: 0, overlappingPaths: [], overlappingResources: [] };
  const store = await loadWorkflowStore();
  let changed = false, activeWorkflowCount = 0, conflictingWorkflowCount = 0;
  const overlappingPaths = new Set<string>(), overlappingResources = new Set<string>();
  const resources = reservedResources.map((value) => value.trim().toLowerCase()).filter(Boolean);
  for (const actor of Object.keys(store.active)) {
    changed = pruneStaleWorkflows(store, actor) || changed;
    for (const workflow of Object.values(store.active[actor] ?? {})) {
      if (normalizedProject(workflow.project) !== key) continue;
      activeWorkflowCount += 1;
      let conflict = false;
      for (const requested of affectedPaths) {
        if ((workflow.orchestration?.affectedPaths ?? []).some((active) => pathScopeOverlaps(requested, active))) {
          overlappingPaths.add(requested); conflict = true;
        }
      }
      const activeResources = (workflow.orchestration?.reservedResources ?? []).map((value) => value.trim().toLowerCase());
      for (const requested of resources) {
        if (activeResources.includes(requested)) { overlappingResources.add(requested); conflict = true; }
      }
      if (conflict) conflictingWorkflowCount += 1;
    }
  }
  if (changed) await persistWorkflowStore(store);
  return {
    activeWorkflowCount, conflictingWorkflowCount,
    overlappingPaths: [...overlappingPaths].slice(0, 80),
    overlappingResources: [...overlappingResources].slice(0, 40),
  };
}

export async function countActiveWorkflowsForProject(project?: string): Promise<number> {
  return (await summarizeProjectContention(project)).activeWorkflowCount;
}
