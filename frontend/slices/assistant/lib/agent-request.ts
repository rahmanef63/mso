import type { Agent } from "./types";
import { HOST_SYSTEM } from "../host-tools/registry";

// THE one place that decides what system prompt reaches the model.
//
// Before this the persona was pushed into history as a fake user turn — once,
// only when the thread was empty — so the agent chosen at turn zero was the agent
// forever. `system` is per-request all the way down (runToolAgent → streamAgentTurn
// → the route body), so rebuilding it each turn is what makes switching agent
// mid-thread actually take effect.
//
// PROMPT CACHE, stated accurately: the route sends ONE system block with a single
// `cache_control: ephemeral` breakpoint at its END, and the tools array carries no
// breakpoint of its own. Anthropic matches a cached prefix up to a breakpoint
// exactly, so ANY change to the persona misses the whole block — including the
// 18-tool schema that precedes it. Putting HOST_SYSTEM first does NOT keep a shared
// prefix warm; it only keeps the string readable.
//
// That cost is accepted here and rejected for tool scoping, which is not a
// contradiction: a per-agent persona is the feature, and a per-agent tool array
// bought nothing (see the scoping decision in CONTRACT.md). If per-agent material
// grows, the fix is a second breakpoint after the shared head, not reordering.
const PERSONA_CAP = 800;
const PROJECT_CONTEXT_CAP = 1000;

export type AlfaWorkContext = {
  id: string;
  name: string;
  path: string;
  branch?: string;
  clean?: boolean;
  head?: string;
  knowledge?: boolean;
  recentMemoryTitles?: string[];
};

function oneLine(value: string | undefined, cap: number): string {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, cap);
}

function projectNote(project?: AlfaWorkContext | null): string {
  if (!project) return "";
  const parts = [
    `Selected MSO project: ${oneLine(project.name, 80)} (${oneLine(project.path, 260)}).`,
    project.branch ? `Branch ${oneLine(project.branch, 120)}.` : "",
    project.clean === true ? "Working tree reported clean." : project.clean === false ? "Working tree has changes." : "",
    project.head ? `HEAD ${oneLine(project.head, 64)}.` : "",
    project.knowledge ? "Project knowledge is available." : "",
    project.recentMemoryTitles?.length ? `Recent project-memory topics: ${project.recentMemoryTitles.map((title) => oneLine(title, 100)).filter(Boolean).slice(0, 6).join("; ")}.` : "",
    "This is read-only work context, not permission to mutate the project.",
  ].filter(Boolean).join(" ");
  return parts ? ` ${parts.slice(0, PROJECT_CONTEXT_CAP)}` : "";
}

export function composeSystem(agent: Agent | undefined, modeNote: string, project?: AlfaWorkContext | null): string {
  const persona = agent?.persona?.trim().slice(0, PERSONA_CAP);
  const identity = agent && persona ? ` You are acting as ${agent.name}. ${persona}` : "";
  return HOST_SYSTEM + modeNote + projectNote(project) + identity;
}
