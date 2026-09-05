import { forgeTargetHash } from "./target-hash";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Scope } from "@/lib/capabilities/scope";
import { runForgeFixture, validateForgeCommand } from "./sandbox";
import type { ForgeCandidate, ForgeCheck, ForgeEvaluation, ForgeFixture, ForgeFunctionSpec } from "./types";

const SCOPE_RANK: Record<Scope, number> = { read: 0, write: 1, exec: 2 };
const MAX_SKILL_BYTES = 24 * 1024;

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function forgeCandidateHash(candidate: ForgeCandidate): string {
  return hashJson({
    version: candidate.version, id: candidate.id, ownerHash: candidate.ownerHash, kind: candidate.kind,
    projectPath: candidate.projectPath, recipe: candidate.recipe, requiredScope: candidate.requiredScope,
    skill: candidate.skill, function: candidate.function,
  });
}

function pass(checks: ForgeCheck[], id: string, detail: string): void { checks.push({ id, state: "pass", detail }); }
function fail(checks: ForgeCheck[], id: string, detail: string): void { checks.push({ id, state: "fail", detail }); }

async function regularProject(projectPath: string): Promise<string | null> {
  const stat = await fs.lstat(projectPath).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
  const real = await fs.realpath(projectPath).catch(() => null);
  return real === path.resolve(projectPath) ? real : null;
}

async function currentTargetHash(candidate: ForgeCandidate): Promise<string> {
  const target = candidate.kind === "skill"
    ? path.join(candidate.projectPath, ".mso", "skills", candidate.skill!.name, "SKILL.md")
    : path.join(candidate.projectPath, ".mso", "functions.json");
  return forgeTargetHash(target);
}

function recipeChecks(candidate: ForgeCandidate, checks: ForgeCheck[]): void {
  const recipe = candidate.recipe, successRate = recipe.attempts > 0 ? recipe.successes / recipe.attempts : 0;
  if (recipe.qualityVersion === 1) pass(checks, "recipe.telemetry", "P1 quality telemetry present");
  else fail(checks, "recipe.telemetry", "recipe lacks P1 quality telemetry");
  if (recipe.successes >= 2) pass(checks, "recipe.repetition", `${recipe.successes} verified successes`);
  else fail(checks, "recipe.repetition", "requires at least two verified successes");
  if (successRate >= 0.9) pass(checks, "recipe.success_rate", `${Math.round(successRate * 1000) / 10}% success`);
  else fail(checks, "recipe.success_rate", `success rate ${Math.round(successRate * 1000) / 10}% is below 90%`);
  if (recipe.bestSteps.length > 0 && recipe.bestSteps.every((step) => step.state === "completed")) pass(checks, "recipe.trace", "best trace is fully completed");
  else fail(checks, "recipe.trace", "best trace contains non-completed steps");
}

function toolChecks(candidate: ForgeCandidate, knownTools: Map<string, Scope>, checks: ForgeCheck[]): void {
  for (const step of candidate.recipe.bestSteps) {
    const scope = knownTools.get(step.tool);
    if (!scope) { fail(checks, `tool.${step.tool}`, "tool no longer exists in the current catalog"); continue; }
    if (SCOPE_RANK[scope] > SCOPE_RANK[candidate.requiredScope]) {
      fail(checks, `tool.${step.tool}`, `tool now needs ${scope}, above candidate ${candidate.requiredScope} scope`);
    } else pass(checks, `tool.${step.tool}`, `current scope ${scope}`);
  }
}

function fixturePass(fixture: ForgeFixture, result: { code: number; stdout: string; stderr: string }): string | null {
  const expected = fixture.expect ?? {}, code = expected.code ?? 0;
  if (result.code !== code) { const note = result.stderr.trim().replace(/\s+/g, " ").slice(0, 180); return `exit ${result.code}, expected ${code}${note ? `: ${note}` : ""}`; }
  if (expected.stdoutIncludes && !result.stdout.includes(expected.stdoutIncludes)) return "stdout did not contain required marker";
  if (expected.stderrExcludes && result.stderr.includes(expected.stderrExcludes)) return "stderr contained forbidden marker";
  return null;
}

type ForgeFixtureRunner = (projectPath: string, spec: ForgeFunctionSpec, fixture: ForgeFixture) => Promise<{ code: number; stdout: string; stderr: string; sandboxImageId?: string }>;

async function functionChecks(candidate: ForgeCandidate, checks: ForgeCheck[], runner: ForgeFixtureRunner): Promise<{ count: number; sandboxImageId?: string; sourceHash?: string }> {
  const spec = candidate.function!;
  let sourceHash: string | undefined;
  try { const resolved = await validateForgeCommand(candidate.projectPath, spec); sourceHash = createHash("sha256").update(await fs.readFile(resolved.script)).digest("hex"); pass(checks, "function.command", "fixed argv resolves only to approved project-owned Node code"); }
  catch (error) { fail(checks, "function.command", error instanceof Error ? error.message : String(error)); return { count: 0 }; }
  if (!spec.fixtures.length) { fail(checks, "function.fixtures", "at least one fixture is required"); return { count: 0 }; }
  let ran = 0, sandboxImageId: string | undefined;
  for (const fixture of spec.fixtures) {
    const result = await runner(candidate.projectPath, spec, fixture); ran++;
    const evidence = result as typeof result & { sandboxImageId?: string }; if (evidence.sandboxImageId) sandboxImageId = evidence.sandboxImageId;
    const reason = fixturePass(fixture, result);
    if (reason) fail(checks, `fixture.${fixture.name}`, reason);
    else pass(checks, `fixture.${fixture.name}`, "sandbox fixture passed");
  }
  return { count: ran, ...(sandboxImageId ? { sandboxImageId } : {}), ...(sourceHash ? { sourceHash } : {}) };
}

export async function evaluateForgeCandidate(input: {
  candidate: ForgeCandidate;
  knownTools: Map<string, Scope>;
  toolsetHash?: string;
  fixtureRunner?: ForgeFixtureRunner;
}): Promise<ForgeEvaluation> {
  const checks: ForgeCheck[] = [];
  const projectReal = await regularProject(input.candidate.projectPath);
  if (projectReal) pass(checks, "project.containment", "project is a regular non-symlink directory");
  else fail(checks, "project.containment", "project path is missing, symlinked, or no longer canonical");
  recipeChecks(input.candidate, checks);
  toolChecks(input.candidate, input.knownTools, checks);

  let fixtureCount = 0, sandboxImageId: string | undefined, sourceHash: string | undefined;
  if (input.candidate.kind === "skill") {
    const bytes = Buffer.byteLength(input.candidate.skill?.content ?? "");
    if (bytes > 0 && bytes <= MAX_SKILL_BYTES) pass(checks, "skill.size", `${bytes} bytes`);
    else fail(checks, "skill.size", `Skill must be 1-${MAX_SKILL_BYTES} bytes`);
    const target = await currentTargetHash(input.candidate);
    if (target === "absent") pass(checks, "skill.target", "destination does not already exist");
    else fail(checks, "skill.target", "destination already exists or is unsafe; forge never overwrites a Skill");
  } else if (projectReal) {
    const fixtures = await functionChecks(input.candidate, checks, input.fixtureRunner ?? runForgeFixture); fixtureCount = fixtures.count; sandboxImageId = fixtures.sandboxImageId; sourceHash = fixtures.sourceHash;
  }

  const targetHash = await currentTargetHash(input.candidate);
  return {
    version: 1,
    candidateHash: forgeCandidateHash(input.candidate),
    passed: checks.every((check) => check.state !== "fail"),
    evaluatedAt: new Date().toISOString(),
    checks,
    targetHash,
    ...(input.toolsetHash ? { toolsetHash: input.toolsetHash } : {}),
    fixtureCount,
    ...(sandboxImageId ? { sandboxImageId } : {}),
    ...(sourceHash ? { sourceHash } : {}),
  };
}
