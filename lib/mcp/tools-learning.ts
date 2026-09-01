import { inspectProject, resolveProjectHint } from "@/lib/host";
import { activeWorkflowForActor, cancelWorkflow, finishWorkflow, markRecipeUsed, startWorkflow } from "@/lib/skills/memory";
import { searchSkillMemory } from "@/lib/skills/search";
import { allows } from "./scope";
import { type McpTool, str, opt, S } from "./tool-kit";
import { toolsetInfo } from "./toolset";
import { WORKFLOW_PROGRESS_URI } from "./ui-resources";

const visibleTools = async (scope: "read" | "write" | "exec"): Promise<McpTool[]> => {
  const { TOOLS } = await import("./tools");
  return TOOLS.filter((tool) => allows(scope, tool.scope));
};

const WORKFLOW_START_OUTPUT = {
  type: "object",
  properties: {
    workflow: { type: "object", additionalProperties: true },
    bootstrap: { type: "object", additionalProperties: true },
    search: { type: "object", additionalProperties: true },
    instruction: { type: "string" },
  },
  required: ["workflow", "bootstrap", "search", "instruction"],
  additionalProperties: true,
} as const;

const WORKFLOW_STATUS_OUTPUT = {
  type: "object",
  properties: {
    active: { type: "boolean" },
    workflowId: { type: "string" },
    intent: { type: "string" },
    project: { type: "string" },
    startedAt: { type: "string" },
    elapsedMs: { type: "number" },
    stepCount: { type: "number" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: { type: "string" },
          state: { type: "string" },
          durationMs: { type: "number" },
          ts: { type: "string" },
        },
        required: ["tool", "state", "ts"],
        additionalProperties: false,
      },
    },
  },
  required: ["active", "workflowId", "stepCount", "steps"],
  additionalProperties: false,
} as const;

export const LEARNING_TOOLS: McpTool[] = [
  {
    name: "workflow_start",
    description:
      "The ONE startup call for a multi-step task. It starts the workflow, searches trusted skills and prior recipes, " +
      "resolves project aliases, reports the current toolset/version, and inspects repository context when available. " +
      "Do not call skills_search first for the same task; this already includes it. Multiple conversations may start isolated workflows on one token; correlate every later step with the returned workflow_id.",
    scope: "write",
    annotations: { idempotentHint: false },
    outputSchema: WORKFLOW_START_OUTPUT,
    meta: {
      ui: { resourceUri: WORKFLOW_PROGRESS_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": WORKFLOW_PROGRESS_URI,
      "openai/toolInvocation/invoking": "Starting MSO workflow…",
      "openai/toolInvocation/invoked": "MSO workflow ready",
    },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.start" as const, targetArg: "project" },
    inputSchema: S({
      intent: { type: "string", description: "The user's task in one complete sentence." },
      project: { type: "string", description: "Optional project id from projects_list, absolute path, name or alias (e.g. os-vps, mso, projects/mso)." },
      constraints: { type: "string", description: "Optional important constraints, such as no downtime or WebP only." },
    }, ["intent"]),
    run: async (a, context) => {
      const actor = context.actor;
      if (!actor) throw new Error("workflow memory needs an authenticated MCP actor");
      const intent = str(a, "intent");
      const projectHint = opt(a, "project");
      const project = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
      const tools = await visibleTools(context.scope);
      // Complete every fallible read-only preflight before allocating the run id.
      // A failed skill scan or repo inspection must not
      // leave a run the client never received an id for and therefore cannot close.
      const search = await searchSkillMemory(intent, {
        topK: 8,
        recipeAccess: { actor, scope: context.scope },
        toolDocs: tools.map((tool) => ({
          name: tool.name, description: tool.description, scope: tool.scope, inputSchema: tool.inputSchema,
        })),
      });
      const repository = project
        ? await inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined)
        : undefined;
      const toolset = toolsetInfo(tools, context.scope);
      // Discovery incompleteness travels WITH the bootstrap. A model told "here is the
      // project and the trusted skills" will not re-check whether the scan covered the
      // whole box; if it did not, it has to be told in the same breath.
      const discovery = {
        catalog: search.catalog,
        complete: !search.catalog.truncated,
      };
      const started = await startWorkflow({
        actor,
        scope: context.scope,
        intent,
        project: project?.path ?? projectHint,
        constraints: opt(a, "constraints"),
      });
      // Recommendation telemetry is useful, but failure to persist lastUsedAt must
      // never turn a successfully-created workflow into an opaque tool failure.
      if (search.recommendedRecipe) {
        await markRecipeUsed(search.recommendedRecipe.id, { actor, scope: context.scope }).catch(() => undefined);
      }
      return {
        ...started,
        bootstrap: {
          ready: true,
          toolset,
          project: project ?? (projectHint ? { hint: projectHint, matchedBy: "unresolved" } : undefined),
          repository,
          discovery,
          trace: [
            `[MSO] connected · ${context.scope} scope · ${toolset.toolCount} tools · ${toolset.version}/${toolset.hash}`,
            project ? `[Project] ${project.hint} → ${project.path} (${project.matchedBy})` : `[Project] ${projectHint ?? "not specified"}`,
            ...(discovery.complete ? [] : [`[Discovery] partial scan — ${search.catalog.truncationReasons.join(", ")}; do not conclude something is absent`]),
            "[Plan] inspect → change → test/build when needed → verify → workflow_finish",
          ],
          policy: {
            simple: "Use bounded tools for one or two direct operations.",
            repository: "For short repository-wide search/git checks use one narrow exec_run batch; for tests/builds that may exceed 30 seconds use exec_job_start and poll exec_job_status.",
            progress: "Show only high-level feature/tool badges and outcomes; never private chain-of-thought.",
            finish: "Call workflow_finish with this exact workflow id only after independent verification; use workflow_cancel for an abandoned run.",
          },
        },
        search,
        instruction: "Use the returned project, trusted skill, and safe recipe directly. Verify the result, then call workflow_finish.",
      };
    },
  },
  {
    name: "workflow_status",
    description:
      "Return a redacted live status snapshot for one workflow. This tool exists for the MSO ChatGPT progress widget: it exposes only workflow identity, timing and high-level tool outcomes, never tool arguments, command strings, file contents or credentials.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: WORKFLOW_STATUS_OUTPUT,
    meta: {
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    },
    limit: { key: "workflow.status", max: 30, windowMs: 60_000 },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
    }),
    run: async (a, context) => {
      const workflowId = str(a, "workflow_id");
      const workflow = await activeWorkflowForActor(context.actor, workflowId);
      if (!workflow) {
        return { active: false, workflowId, stepCount: 0, steps: [] };
      }
      const started = Date.parse(workflow.startedAt);
      return {
        active: true,
        workflowId,
        intent: workflow.intent,
        ...(workflow.project ? { project: workflow.project } : {}),
        startedAt: workflow.startedAt,
        elapsedMs: Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0,
        stepCount: workflow.steps.length,
        steps: workflow.steps.slice(-8).map((step) => ({
          tool: step.tool,
          state: step.state,
          ...(typeof step.durationMs === "number" ? { durationMs: step.durationMs } : {}),
          ts: step.ts,
        })),
      };
    },
  },
  {
    name: "workflow_cancel",
    description:
      "Cancel one exact active workflow without saving a learned recipe. Use this only when the task is being abandoned or the prior run was interrupted; " +
      "workflow_id is required so a different conversation cannot be cancelled accidentally.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.cancel" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
      reason: { type: "string", description: "Optional concise reason; no secrets or file contents." },
    }, ["workflow_id"]),
    run: (a, context) => cancelWorkflow({
      actor: context.actor,
      workflowId: str(a, "workflow_id"),
      reason: opt(a, "reason"),
    }),
  },
  {
    name: "workflow_finish",
    description:
      "Finish one exact learned workflow after verification. workflow_id is required so another conversation using the same token cannot close the wrong run. " +
      "MSO saves the redacted sequence and keeps the fastest successful path. Never put credentials or raw file contents in summary.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.finish" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
      summary: { type: "string", description: "Concise outcome and verification result; no secrets." },
      success: { type: "boolean", description: "True only after the requested result is verified." },
    }, ["workflow_id", "summary", "success"]),
    run: (a, context) => finishWorkflow({
      actor: context.actor,
      workflowId: str(a, "workflow_id"),
      summary: str(a, "summary"),
      success: a.success === true,
    }),
  },
];
