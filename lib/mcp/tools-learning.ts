import { inspectProject, resolveProjectHint } from "@/lib/host";
import { cancelWorkflow, finishWorkflow, markRecipeUsed, startWorkflow } from "@/lib/skills/memory";
import { searchSkillMemory } from "@/lib/skills/search";
import { allows } from "./scope";
import { type McpTool, str, opt, S } from "./tool-kit";
import { toolsetInfo } from "./toolset";

const visibleTools = async (scope: "read" | "write" | "exec"): Promise<McpTool[]> => {
  const { TOOLS } = await import("./tools");
  return TOOLS.filter((tool) => allows(scope, tool.scope));
};

export const LEARNING_TOOLS: McpTool[] = [
  {
    name: "workflow_start",
    description:
      "The ONE startup call for a multi-step task. It starts the workflow, searches trusted skills and prior recipes, " +
      "resolves project aliases, reports the current toolset/version, and inspects repository context when available. " +
      "Do not call skills_search first for the same task; this already includes it. Multiple conversations may start isolated workflows on the same token; correlate every later step with the returned workflow_id.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.start" as const, targetArg: "project" },
    inputSchema: S({
      intent: { type: "string", description: "The user's task in one complete sentence." },
      project: { type: "string", description: "Optional project id from projects_list, absolute path, name or alias (e.g. os-vps, mso, projects/mso)." },
      constraints: { type: "string", description: "Optional important constraints, such as no downtime or WebP only." },
    }, ["intent"]),
    run: async (a, context) => {
      const intent = str(a, "intent");
      const projectHint = opt(a, "project");
      const project = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
      const tools = await visibleTools(context.scope);
      // Complete every fallible read-only preflight before allocating the run id.
      // A failed skill scan or repo inspection must not
      // leave a run the client never received an id for and therefore cannot close.
      const search = await searchSkillMemory(intent, {
        topK: 8,
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
        actor: context.actor,
        intent,
        project: project?.path ?? projectHint,
        constraints: opt(a, "constraints"),
      });
      // Recommendation telemetry is useful, but failure to persist lastUsedAt must
      // never turn a successfully-created workflow into an opaque tool failure.
      if (search.recommendedRecipe) await markRecipeUsed(search.recommendedRecipe.id).catch(() => undefined);
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
