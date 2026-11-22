import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

export const ONBOARDING_KEY = "mso:onboarding:v1";
export const ONBOARDING_OPEN = "mso:onboarding:open";
const PROGRESS_KEY = "mso:onboarding:progress:v2";
export const ONBOARDING_STEPS = ["welcome", "readiness", "project", "receipt"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingProject = { id: string; name: string };
export type OnboardingProgress = {
  step: OnboardingStep;
  project?: OnboardingProject;
  attempt?: { graphId: string; key: string; runId?: string };
};
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
const text = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const id = (value: unknown): value is string => text(value, 96) && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);

export function onboardingStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readOnboardingProgress(storage: StorageReader | undefined): OnboardingProgress {
  try {
    const value = JSON.parse(storage?.getItem(PROGRESS_KEY) || "null");
    if (!value || !ONBOARDING_STEPS.includes(value.step)) return { step: "welcome" };
    const project = value.project;
    if (!project || !text(project.id, 1000) || !text(project.name, 255)) return { step: value.step === "receipt" ? "project" : value.step };
    const attempt = value.attempt;
    return {
      step: value.step, project: { id: project.id, name: project.name },
      ...(attempt && id(attempt.graphId) && id(attempt.key) ? {
        attempt: { graphId: attempt.graphId, key: attempt.key, ...(id(attempt.runId) ? { runId: attempt.runId } : {}) },
      } : {}),
    };
  } catch { return { step: "welcome" }; }
}

export function writeOnboardingProgress(storage: StorageWriter | undefined, progress: OnboardingProgress): boolean {
  if (!storage) return false;
  const value: OnboardingProgress = {
    step: progress.step,
    ...(progress.project ? { project: { id: progress.project.id, name: progress.project.name } } : {}),
    ...(progress.attempt ? { attempt: { graphId: progress.attempt.graphId, key: progress.attempt.key, ...(progress.attempt.runId ? { runId: progress.attempt.runId } : {}) } } : {}),
  };
  try { storage.setItem(PROGRESS_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function shouldOpenOnboarding(storage: StorageReader | undefined): boolean {
  try { return storage?.getItem(ONBOARDING_KEY) !== "done"; }
  catch { return true; }
}

// The guide's open state lives in storage, not in React state. A `useState`
// initializer that read it opened the dialog on the client only, because the
// server never sees localStorage — a hydration mismatch React then reported
// against whatever boundary it rebuilt. `useSyncExternalStore` keeps both passes
// closed (server snapshot = false) and re-reads after a real change.
const onboardingListeners = new Set<() => void>();

export function notifyOnboarding(): void {
  for (const listener of onboardingListeners) listener();
}

export function subscribeOnboarding(listener: () => void): () => void {
  onboardingListeners.add(listener);
  // The shell's "reopen from Settings" signal is a plain event, so the snapshot
  // has to be re-read when it fires.
  globalThis.addEventListener?.(ONBOARDING_OPEN, listener);
  return () => {
    onboardingListeners.delete(listener);
    globalThis.removeEventListener?.(ONBOARDING_OPEN, listener);
  };
}

export function firstCheckGraph(project: OnboardingProject, graphId: string) {
  return {
    id: graphId, name: `First project check: ${project.name}`.slice(0, 160),
    description: "Resolve an exact project and read its status. Saves workflow evidence without changing project files or calling a model.",
    status: "draft" as const, inputs: {}, metadata: { project: project.id, provenance: "user" as const, tags: ["onboarding"] },
    nodes: [
      { id: "start", name: "Manual check", type: "manual" as const, position: { x: 60, y: 120 }, config: {} },
      { id: "project", name: "Resolve project", type: "project" as const, position: { x: 300, y: 120 }, config: { project: project.id } },
      { id: "inspect", name: "Read project status", type: "tool" as const, position: { x: 540, y: 120 }, config: { tool: "project_get", arguments: { project: { $ref: "nodes.project.output.id" } } } },
      { id: "receipt", name: "Project result", type: "output" as const, position: { x: 780, y: 120 }, config: { value: { $ref: "nodes.inspect.output" } } },
    ],
    edges: [
      { id: "resolve", source: "start", target: "project" },
      { id: "inspect", source: "project", target: "inspect" },
      { id: "record", source: "inspect", target: "receipt" },
    ],
  };
}

export function matchesFirstCheck(graph: WorkflowGraph, project: OnboardingProject, graphId: string): boolean {
  const expected = firstCheckGraph(project, graphId);
  return Boolean(graph) && graph.id === graphId && graph.status === "draft"
    && JSON.stringify(graph.inputs) === JSON.stringify(expected.inputs)
    && JSON.stringify(graph.nodes) === JSON.stringify(expected.nodes)
    && JSON.stringify(graph.edges) === JSON.stringify(expected.edges)
    && JSON.stringify(graph.metadata) === JSON.stringify(expected.metadata);
}
