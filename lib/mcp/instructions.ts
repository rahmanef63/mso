import type { Scope } from "./scope";
import type { McpToolProfile } from "./tool-contract";

/** Official orientation skill. Keep this id stable: MCP `skills_search` and ChatGPT publication both use it. */
export const AGENT_BOOTSTRAP_SKILL = "mso-agent-bootstrap";

export type AgentBootstrapStep = {
  n: number;
  call: string;
  when: string;
  detail: string;
};

/** Canonical first-call sequence. Presentation may differ by surface; this order does not. */
export const AGENT_BOOTSTRAP_STEPS: readonly AgentBootstrapStep[] = [
  { n: 1, call: "skills_search|skills_read", when: "Learn the map", detail: `Query or read official skill ${AGENT_BOOTSTRAP_SKILL} before expensive mutations.` },
  { n: 2, call: "projects_list", when: "Project unresolved", detail: "Resolve id/path/alias; do not guess across roots." },
  { n: 3, call: "workflow_start", when: "Multi-step work", detail: "Call once; pass exact workflow_id on every later operation." },
  { n: 4, call: "project_capabilities→project_mcp_tools→project_mcp_call", when: "Project MCP", detail: "Keep discover and call as two tools; never copy project names into the global catalog." },
  { n: 5, call: "integration_query→setup/verify→integration_execute", when: "Credentials", detail: "Never put secrets in chat or tool arguments." },
  { n: 6, call: "read_pipeline|bounded reads", when: "Inspect", detail: "Prefer these before exec_run." },
  { n: 7, call: "bounded infra + confirm", when: "Mutate infra", detail: "Doctor/health first; mutations need confirm." },
];

export function formatAgentBootstrapSteps(scope: Scope = "exec"): string {
  const steps = scope === "read"
    ? AGENT_BOOTSTRAP_STEPS.filter((step) => step.n !== 3)
    : AGENT_BOOTSTRAP_STEPS;
  return steps.map((step) => `${step.n}) ${step.call} (${step.when}: ${step.detail})`).join(" ");
}

export function workflowOrientation(scope: Scope = "exec") {
  const steps = scope === "read"
    ? AGENT_BOOTSTRAP_STEPS.filter((step) => step.n !== 3)
    : AGENT_BOOTSTRAP_STEPS;
  return {
    skill: AGENT_BOOTSTRAP_SKILL,
    scope,
    steps,
    finish: scope === "read"
      ? "Read-only tokens cannot start or finish workflows; stay on bounded reads."
      : "After independent verification call workflow_finish with this exact workflow_id; abandon with workflow_cancel.",
  };
}

export function workflowStartPolicy(classification: { risk: string; isolation: string }) {
  return {
    simple: "LOW-risk work may run directly with a targeted check; branch/worktree is a safety tool, not a goal.",
    isolation: classification.risk === "high"
      ? "HIGH-risk work requires isolation plus explicit verification before integration."
      : classification.isolation === "optional-worktree"
        ? "Use a short-lived branch/worktree when it reduces current contention."
        : "Direct work is acceptable when scope remains isolated.",
    repository: "For short repository-wide search/git checks use one narrow exec_run batch; for tests/builds that may exceed 30 seconds use exec_job_start and poll exec_job_status.",
    progress: "Show only high-level feature/tool badges and outcomes; never private chain-of-thought.",
    manualUserTest: "When the user reports a manual test result, persist it with project_memory_upsert source=user-manual; a failed manual test outranks an automated healthy assumption.",
    finish: "Call workflow_finish with this exact workflow id only after independent verification; new HIGH-risk workflows require structured evidence. Use workflow_cancel for an abandoned run.",
  };
}

export function mcpInstructions(scope: Scope, profile: McpToolProfile = "full", allowedTools?: readonly string[]): string {
  const bootstrap = formatAgentBootstrapSteps(scope);
  const startup = allowedTools
    ? `This machine token is restricted to: ${allowedTools.join(", ")}.`
    : scope === "read"
      ? `This token is read-only. MSO agent bootstrap: ${bootstrap} Multi-step mutation tools are unavailable at this scope.`
      : `MSO agent bootstrap: ${bootstrap} Then verify and workflow_finish, or workflow_cancel.`;
  const projectBoundary = profile === "chatgpt"
    ? " Project-owned MCP tools never join this catalog: use project_mcp_tools then project_mcp_call."
    : "";
  return `${startup}${projectBoundary} Call agent_session_open for provider-neutral sessions, then send params._meta[mso/sessionId]. Use flow_catalog to inspect required inputs before flow_run; flow_status waits for completion. Session/workflow state is isolated per conversation. Prefer bounded tools and exec_job_start for long builds. Never expose hidden transcripts, credentials, or private chain-of-thought.`;
}
