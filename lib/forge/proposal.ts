import type { LearnedRecipe } from "@/lib/workflow";
import { createForgeCandidate, forgeOwnerHash, newForgeCandidateId } from "./store";
import type { ForgeCandidate, ForgeFixture, ForgeFunctionSpec, ForgeKind, ForgeRecipeSnapshot } from "./types";

const NAME_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const SECRETISH = /(password|passwd|secret|token|authorization|bearer|api[_-]?key)/i;
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function cleanText(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function slug(value: string): string {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);
  return /^[a-z]/.test(base) ? base : `workflow-${base || "candidate"}`;
}

function candidateName(value: string | undefined, recipe: LearnedRecipe): string {
  const name = cleanText(value || slug(recipe.intent), 64).toLowerCase();
  if (!NAME_RE.test(name)) throw new Error("forge candidate name must match ^[a-z][a-z0-9_.-]{0,63}$");
  return name;
}

function recipeSnapshot(recipe: LearnedRecipe): ForgeRecipeSnapshot {
  return {
    id: recipe.id,
    scope: recipe.scope,
    intent: cleanText(recipe.intent, 1000),
    summary: cleanText(recipe.summary, 1200),
    attempts: recipe.attempts,
    successes: recipe.successes,
    failures: recipe.failures,
    ...(recipe.qualityVersion === 1 ? { qualityVersion: 1 as const } : {}),
    quality: recipe.quality,
    bestSteps: recipe.bestSteps.map((step) => ({ tool: step.tool, state: step.state, ...(step.target ? { target: cleanText(step.target, 160) } : {}) })),
    updatedAt: recipe.updatedAt,
  };
}

export function assertRecipeForgeEligible(recipe: LearnedRecipe): void {
  if (recipe.qualityVersion !== 1) throw new Error("recipe has no P1 quality telemetry; run and verify it again before forging");
  if (recipe.successes < 2) throw new Error("tool forge requires at least two verified successful runs");
  const rate = recipe.attempts > 0 ? recipe.successes / recipe.attempts : 0;
  if (rate < 0.9) throw new Error("tool forge requires at least 90% workflow success");
  if (!recipe.bestSteps.length || recipe.bestSteps.some((step) => step.state !== "completed")) {
    throw new Error("tool forge requires a fully completed best workflow trace");
  }
}

function skillContent(name: string, recipe: ForgeRecipeSnapshot): string {
  const description = cleanText(`Verified procedure for ${recipe.intent}`, 220);
  const steps = recipe.bestSteps.map((step, index) => `${index + 1}. Use \`${step.tool}\` under the caller's normal scope/approval guards.`).join("\n");
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nuser-invocable: false\nmetadata:\n  mso:\n    forged: true\n    recipe: ${recipe.id}\n    required-scope: ${recipe.scope}\n---\n\n# ${name}\n\nGenerated from a repeated, verified MSO workflow. This Skill is guidance only: it never grants permissions and every tool call still uses the caller's normal scope/approval guards.\n\n## Verified procedure\n\n${steps}\n\n## Verification\n\nRe-check the requested outcome independently before reporting success. For multi-step MCP work, keep the exact workflow id and finish only after verification.\n`;
}

function inputSchema(value: unknown): ForgeFunctionSpec["inputSchema"] {
  if (value === undefined) return { type: "object", properties: {}, additionalProperties: false };
  if (!plainObject(value) || value.type !== "object" || !plainObject(value.properties)) throw new Error("input_schema must be an object JSON Schema");
  const secretProperty = Object.keys(value.properties).find((key) => SECRETISH.test(key));
  if (secretProperty) throw new Error(`input_schema may not expose credential-like field ${secretProperty}; use server-side project configuration`);
  const required = value.required;
  if (required !== undefined && (!Array.isArray(required) || !required.every((row) => typeof row === "string"))) throw new Error("input_schema.required must be a string array");
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") throw new Error("input_schema.additionalProperties must be boolean");
  return {
    type: "object",
    properties: value.properties,
    ...(required ? { required: [...new Set(required)] } : {}),
    ...(typeof value.additionalProperties === "boolean" ? { additionalProperties: value.additionalProperties } : {}),
  };
}

function containsSecretLikePayload(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((row) => containsSecretLikePayload(row, depth + 1));
  if (!plainObject(value)) return typeof value === "string" && /^(?:Bearer\s+|sk-[A-Za-z0-9_-]{12,})/i.test(value.trim());
  return Object.entries(value).some(([key, row]) => SECRETISH.test(key) || containsSecretLikePayload(row, depth + 1));
}

function fixtures(value: unknown): ForgeFixture[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) throw new Error("project-function candidates require 1-8 fixtures");
  return value.map((row, index) => {
    if (!plainObject(row) || !plainObject(row.input)) throw new Error(`fixtures[${index}] must contain an object input`);
    if (containsSecretLikePayload(row.input)) throw new Error(`fixtures[${index}] contains credential-like input; Forge fixtures must use non-secret synthetic data`);
    const expect = plainObject(row.expect) ? row.expect : undefined;
    return {
      name: cleanText(typeof row.name === "string" ? row.name : `fixture-${index + 1}`, 80),
      input: row.input,
      ...(expect ? { expect: {
        ...(Number.isInteger(expect.code) ? { code: Number(expect.code) } : {}),
        ...(typeof expect.stdoutIncludes === "string" ? { stdoutIncludes: cleanText(expect.stdoutIncludes, 240) } : {}),
        ...(typeof expect.stderrExcludes === "string" ? { stderrExcludes: cleanText(expect.stderrExcludes, 240) } : {}),
      } } : {}),
    };
  });
}

export async function proposeForgeCandidate(input: {
  owner: string;
  recipe: LearnedRecipe;
  kind: ForgeKind;
  projectPath: string;
  name?: string;
  description?: string;
  command?: unknown;
  inputSchema?: unknown;
  fixtures?: unknown;
  timeoutMs?: number;
}): Promise<ForgeCandidate> {
  assertRecipeForgeEligible(input.recipe);
  const name = candidateName(input.name, input.recipe), recipe = recipeSnapshot(input.recipe);
  const now = new Date().toISOString();
  const base = {
    version: 1 as const,
    id: newForgeCandidateId(),
    ownerHash: forgeOwnerHash(input.owner),
    kind: input.kind,
    state: "draft" as const,
    projectPath: input.projectPath,
    recipe,
    requiredScope: recipe.scope,
    createdAt: now,
    updatedAt: now,
  };
  if (input.kind === "skill") return createForgeCandidate({ ...base, skill: { name, content: skillContent(name, recipe) } });

  if (input.recipe.scope !== "exec") throw new Error("project-function Forge candidates require an exec-scope verified recipe; read/write recipes cannot be promoted into executable capabilities");
  if (!Array.isArray(input.command) || input.command.length < 1 || !input.command.every((row) => typeof row === "string")) {
    throw new Error("project-function candidate command must be a fixed argv string array");
  }
  const fn: ForgeFunctionSpec = {
    name,
    description: cleanText(input.description || `Forged project function for ${recipe.intent}`, 600),
    inputSchema: inputSchema(input.inputSchema),
    command: input.command.slice(0, 16) as string[],
    timeoutMs: Number.isInteger(input.timeoutMs) ? Math.max(1000, Math.min(30_000, Number(input.timeoutMs))) : 10_000,
    fixtures: fixtures(input.fixtures),
  };
  return createForgeCandidate({ ...base, requiredScope: "exec", function: fn });
}
