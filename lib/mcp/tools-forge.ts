import { resolveProjectHint } from "@/lib/host";
import { evaluateForgeCandidate } from "@/lib/forge/evaluate";
import { promoteForgeCandidate } from "@/lib/forge/promote";
import { proposeForgeCandidate } from "@/lib/forge/proposal";
import { getForgeCandidate, listForgeCandidates, publicForgeCandidate, updateForgeCandidate } from "@/lib/forge/store";
import { listLearnedRecipes } from "@/lib/workflow";
import { type McpTool, S, str, opt } from "./tool-kit";
import { toolsetInfo } from "./toolset";

function forgeOwner(context: { recipeActor?: string; actor?: string }): string {
  const owner = context.recipeActor ?? context.actor;
  if (!owner) throw new Error("Tool Forge needs an authenticated client owner");
  return owner;
}

function kind(a: Record<string, unknown>): "skill" | "project_function" {
  const value = str(a, "kind");
  if (value !== "skill" && value !== "project_function") throw new Error("kind must be skill or project_function");
  return value;
}

async function currentToolEvidence() {
  const { TOOLS } = await import("./tools");
  return {
    scopes: new Map(TOOLS.map((tool) => [tool.name, tool.scope])),
    toolset: toolsetInfo(TOOLS),
  };
}

async function freshEvaluation(candidate: Awaited<ReturnType<typeof getForgeCandidate>>) {
  if (!candidate) throw new Error("forge candidate not found");
  const evidence = await currentToolEvidence();
  return evaluateForgeCandidate({ candidate, knownTools: evidence.scopes, toolsetHash: evidence.toolset.hash });
}

export const FORGE_TOOLS: McpTool[] = [
  {
    name: "tool_forge_candidates",
    description:
      "List this MCP client's private Tool Forge candidates, or inspect one exact candidate id. Commands and fixture payloads stay redacted. " +
      "A candidate is inert until explicit evaluation and promotion.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({ candidate_id: { type: "string", description: "Optional exact forge candidate id." } }),
    run: async (a, context) => {
      const owner = forgeOwner(context), id = opt(a, "candidate_id");
      if (id) {
        const candidate = await getForgeCandidate(id, owner);
        if (!candidate) throw new Error("forge candidate not found");
        return publicForgeCandidate(candidate);
      }
      return { candidates: (await listForgeCandidates(owner)).map(publicForgeCandidate) };
    },
  },
  {
    name: "tool_forge_propose",
    description:
      "Create an INERT Tool Forge candidate from one repeated verified learned workflow. Requires P1 quality telemetry, at least two successful runs, >=90% success, and a fully-completed best trace. " +
      "Skill candidates contain only redacted tool guidance. Project-function candidates must point to an existing project-owned Node script; Tool Forge never generates executable code.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "tool.forge.propose", max: 20, windowMs: 60_000 },
    audit: { action: "tool.forge.propose" as const, targetArg: "project" },
    inputSchema: S({
      recipe_id: { type: "string", description: "Exact learned recipe id from workflow learning/search output." },
      kind: { type: "string", enum: ["skill", "project_function"] },
      project: { type: "string", description: "Exact project id/path/name resolvable by projects_list." },
      name: { type: "string", description: "Optional candidate name; lowercase safe identifier." },
      description: { type: "string", description: "Project-function description." },
      command: { type: "array", items: { type: "string" }, description: "Project-function fixed argv. P2 accepts Node + a project-owned script only." },
      input_schema: { type: "object", description: "Project-function JSON input schema." },
      fixtures: { type: "array", description: "1-8 sandbox fixtures for project-function candidates." },
      timeout_ms: { type: "number", description: "Project-function timeout, 1000-30000ms." },
    }, ["recipe_id", "kind", "project"]),
    run: async (a, context) => {
      const owner = forgeOwner(context), project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const recipes = await listLearnedRecipes({ actor: owner, scope: context.scope });
      const recipe = recipes.find((row) => row.id === str(a, "recipe_id"));
      if (!recipe) throw new Error("learned recipe not found for this client/scope");
      const candidate = await proposeForgeCandidate({
        owner, recipe, kind: kind(a), projectPath: project.path, name: opt(a, "name"), description: opt(a, "description"),
        command: a.command, inputSchema: a.input_schema, fixtures: a.fixtures,
        timeoutMs: a.timeout_ms === undefined ? undefined : Number(a.timeout_ms),
      });
      return publicForgeCandidate(candidate);
    },
  },
  {
    name: "tool_forge_evaluate",
    description:
      "Evaluate one inert Tool Forge candidate against the CURRENT tool catalog and target state. Project-function fixtures execute only in the configured cached Docker sandbox: network none, read-only root/project, no capabilities, no-new-privileges, bounded CPU/memory/PIDs. " +
      "Evaluation never promotes or executes the candidate on the host.",
    scope: "exec",
    annotations: { destructiveHint: false, openWorldHint: false },
    limit: { key: "tool.forge.evaluate", max: 10, windowMs: 60_000 },
    audit: { action: "tool.forge.evaluate" as const, targetArg: "candidate_id" },
    inputSchema: S({ candidate_id: { type: "string", description: "Exact forge candidate id." } }, ["candidate_id"]),
    run: async (a, context) => {
      const owner = forgeOwner(context), id = str(a, "candidate_id"), current = await getForgeCandidate(id, owner);
      const evaluation = await freshEvaluation(current);
      const updated = await updateForgeCandidate(id, owner, (candidate) => ({
        ...candidate, state: evaluation.passed ? "evaluated" : "draft", evaluation, updatedAt: new Date().toISOString(),
      }));
      return publicForgeCandidate(updated);
    },
  },
  {
    name: "tool_forge_promote",
    description:
      "Explicitly promote one Tool Forge candidate into its project. Requires confirmation exactly `PROMOTE <candidate_id>`. MSO re-runs the complete evaluation immediately before promotion, refuses target/tool/image drift, never overwrites existing Skills/functions, and verifies the promoted artifact afterward. " +
      "Use only after reviewing tool_forge_candidates/evaluation evidence.",
    scope: "exec",
    annotations: { destructiveHint: true, openWorldHint: false },
    limit: { key: "tool.forge.promote", max: 6, windowMs: 60_000 },
    audit: { action: "tool.forge.promote" as const, targetArg: "candidate_id" },
    inputSchema: S({
      candidate_id: { type: "string", description: "Exact forge candidate id." },
      confirmation: { type: "string", description: "Must exactly equal PROMOTE <candidate_id>." },
    }, ["candidate_id", "confirmation"]),
    run: async (a, context) => {
      const owner = forgeOwner(context), id = str(a, "candidate_id");
      if (str(a, "confirmation") !== `PROMOTE ${id}`) throw new Error(`promotion confirmation must exactly equal PROMOTE ${id}`);
      const current = await getForgeCandidate(id, owner);
      if (!current) throw new Error("forge candidate not found");
      if (current.state === "promoted") throw new Error("forge candidate is already promoted");
      const evaluation = await freshEvaluation(current);
      if (!evaluation.passed) {
        await updateForgeCandidate(id, owner, (candidate) => ({ ...candidate, state: "draft", evaluation, updatedAt: new Date().toISOString() }));
        throw new Error("fresh Tool Forge evaluation failed; inspect the candidate before retrying promotion");
      }
      const evaluated = { ...current, state: "evaluated" as const, evaluation, updatedAt: new Date().toISOString() };
      const promotion = await promoteForgeCandidate(evaluated);
      const promoted = await updateForgeCandidate(id, owner, () => ({ ...evaluated, state: "promoted", promotion, updatedAt: promotion.at }));
      return publicForgeCandidate(promoted);
    },
  },
];
