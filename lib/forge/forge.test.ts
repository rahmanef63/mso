import { existsSync, promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnedRecipe, WorkflowQuality } from "@/lib/workflow";
import { projectSkillTrust } from "@/lib/skills/project-skills";
import { readProjectFunctionsManifest } from "@/lib/host/project-function-manifest";
import { runProjectFunction } from "@/lib/host/project-function-runner";
import { evaluateForgeCandidate } from "./evaluate";
import { promoteForgeCandidate } from "./promote";
import { proposeForgeCandidate } from "./proposal";

const QUALITY: WorkflowQuality = {
  stepAttempts: 2, completedSteps: 2, failedSteps: 0, deniedSteps: 0, rateLimitedSteps: 0,
  invalidArgSteps: 0, retries: 0, rollbackSignals: 0, timedSteps: 2, totalStepDurationMs: 20, averageStepDurationMs: 10,
};

function recipe(overrides: Partial<LearnedRecipe> = {}): LearnedRecipe {
  const now = "2026-09-02T05:00:00.000Z";
  return {
    id: "recipe-1", actor: "mcp-client:test", scope: "read", intent: "inspect project health", normalizedIntent: "inspect project health",
    project: "/tmp/project", summary: "verified project health", embeddingVersion: "test", embedding: [],
    bestSteps: [
      { id: "1", tool: "projects_list", state: "completed", target: "project", ts: now },
      { id: "2", tool: "sys_stats", state: "completed", target: "server", ts: now },
    ],
    lastSteps: [], attempts: 2, successes: 2, failures: 0, averageDurationMs: 10, fastestDurationMs: 9,
    lastDurationMs: 9, averageWallDurationMs: 12, lastWallDurationMs: 11, quality: QUALITY, lastQuality: QUALITY,
    qualityVersion: 1, createdAt: now, updatedAt: now, ...overrides,
  };
}

async function tempProject(): Promise<{ root: string; project: string; forge: string }> {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".mso-forge-test-"));
  const project = path.join(root, "project"), forge = path.join(root, "forge");
  await fs.mkdir(project, { recursive: true });
  process.env.OS_TOOL_FORGE_DIR = forge;
  return { root, project, forge };
}


const dockerSandboxAvailable = existsSync("/usr/bin/docker") && spawnSync(
  "/usr/bin/docker", ["image", "inspect", "mso-forge-sandbox:node22-v1"], { stdio: "ignore", timeout: 3000 },
).status === 0;

const roots: string[] = [];
afterEach(async () => {
  delete process.env.OS_TOOL_FORGE_DIR;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("eval-gated Tool Forge", () => {
  it("refuses to forge from a one-off workflow without repeated verified success", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    await expect(proposeForgeCandidate({ owner: "owner", recipe: recipe({ attempts: 1, successes: 1 }), kind: "skill", projectPath: project }))
      .rejects.toThrow(/at least two verified successful runs/i);
  });

  it("generates a bounded Skill, evaluates current tool references, promotes once, and refuses overwrite", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    const candidate = await proposeForgeCandidate({ owner: "owner", recipe: recipe(), kind: "skill", projectPath: project, name: "project-health" });
    const evaluation = await evaluateForgeCandidate({
      candidate,
      knownTools: new Map([["projects_list", "read"], ["sys_stats", "read"]]),
      toolsetHash: "toolset-test",
    });
    expect(evaluation.passed).toBe(true);
    const evaluated = { ...candidate, state: "evaluated" as const, evaluation };
    const promotion = await promoteForgeCandidate(evaluated);
    const skillDir = path.dirname(promotion.path);
    expect(await projectSkillTrust(skillDir, project)).toBe("local");
    await expect(promoteForgeCandidate(evaluated)).rejects.toThrow(/overwrite an existing Skill/i);
  });

  it("refuses to turn a read-scope recipe into an executable project function", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    await expect(proposeForgeCandidate({
      owner: "owner", recipe: recipe({ scope: "read" }), kind: "project_function", projectPath: project, name: "scope-escalation",
      command: [process.execPath, "tool.mjs"], inputSchema: { type: "object", properties: {} }, fixtures: [{ name: "x", input: {} }],
    })).rejects.toThrow(/exec-scope verified recipe/i);
  });

  it("rejects credential-like project-function inputs and fixtures", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    await expect(proposeForgeCandidate({
      owner: "owner", recipe: recipe({ scope: "exec" }), kind: "project_function", projectPath: project, name: "secret-input",
      command: [process.execPath, "tool.mjs"], inputSchema: { type: "object", properties: { apiKey: { type: "string" } } },
      fixtures: [{ name: "secret", input: { token: "sk-example-secret-value" } }],
    })).rejects.toThrow(/credential-like/i);
  });

  it("rejects shell-inline project functions before any fixture runs", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    const candidate = await proposeForgeCandidate({
      owner: "owner", recipe: recipe({ scope: "exec" }), kind: "project_function", projectPath: project, name: "bad-shell",
      command: ["/bin/bash", "-c", "echo unsafe"], inputSchema: { type: "object", properties: {} }, fixtures: [{ name: "nope", input: {} }],
    });
    const evaluation = await evaluateForgeCandidate({ candidate, knownTools: new Map([["projects_list", "read"], ["sys_stats", "read"]]) });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.find((row) => row.id === "function.command")?.state).toBe("fail");
    expect(evaluation.fixtureCount).toBe(0);
  });

  it.runIf(dockerSandboxAvailable)("runs fixtures in the Docker sandbox before promoting an existing project-owned Node function", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    const script = path.join(project, "echo-function.mjs");
    await fs.writeFile(script, `let s=""; for await (const c of process.stdin) s+=c; const v=JSON.parse(s); console.log("OK:"+v.value);\n`, { mode: 0o700 });
    const candidate = await proposeForgeCandidate({
      owner: "owner", recipe: recipe({ scope: "exec" }), kind: "project_function", projectPath: project, name: "echo-payload",
      description: "Echo a validated fixture payload", command: [process.execPath, "echo-function.mjs"],
      inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
      fixtures: [{ name: "basic", input: { value: "fixture" }, expect: { code: 0, stdoutIncludes: "OK:fixture" } }],
    });
    const evaluation = await evaluateForgeCandidate({ candidate, knownTools: new Map([["projects_list", "read"], ["sys_stats", "read"]]) });
    expect(evaluation.passed).toBe(true);
    expect(evaluation.fixtureCount).toBe(1);
    const evaluated = { ...candidate, state: "evaluated" as const, evaluation };
    await promoteForgeCandidate(evaluated);
    const manifest = await readProjectFunctionsManifest(project);
    expect(manifest.found && manifest.functions?.some((row) => row.name === "echo-payload")).toBe(true);
    const result = await runProjectFunction(project, "echo-payload", { value: "runtime" });
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("OK:runtime");
  });

  it.runIf(dockerSandboxAvailable)("refuses promotion when project-owned source changes after evaluation", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    const script = path.join(project, "drift.mjs");
    await fs.writeFile(script, `console.log("v1");\n`, { mode: 0o700 });
    const candidate = await proposeForgeCandidate({
      owner: "owner", recipe: recipe({ scope: "exec" }), kind: "project_function", projectPath: project, name: "drift-proof",
      command: [process.execPath, "drift.mjs"], inputSchema: { type: "object", properties: {}, additionalProperties: false },
      fixtures: [{ name: "v1", input: {}, expect: { stdoutIncludes: "v1" } }],
    });
    const evaluation = await evaluateForgeCandidate({ candidate, knownTools: new Map([["projects_list", "read"], ["sys_stats", "read"]]) });
    expect(evaluation.passed).toBe(true);
    await fs.writeFile(script, `console.log("v2");\n`, { mode: 0o700 });
    await expect(promoteForgeCandidate({ ...candidate, state: "evaluated", evaluation })).rejects.toThrow(/source changed after evaluation/i);
  });

  it.runIf(dockerSandboxAvailable)("keeps the project mount read-only and network disabled inside Forge fixtures", async () => {
    const { root, project } = await tempProject(); roots.push(root);
    const script = path.join(project, "sandbox-proof.mjs");
    await fs.writeFile(script, `import fs from "node:fs"; let ro=false, net=false; try { fs.writeFileSync("forge-escape.txt", "x"); } catch { ro=true; } try { await fetch("http://127.0.0.1:4005", { signal: AbortSignal.timeout(500) }); } catch { net=true; } console.log("RO:"+ro+" NET:"+net);\n`, { mode: 0o700 });
    const candidate = await proposeForgeCandidate({
      owner: "owner", recipe: recipe({ scope: "exec" }), kind: "project_function", projectPath: project, name: "sandbox-proof",
      command: [process.execPath, "sandbox-proof.mjs"], inputSchema: { type: "object", properties: {}, additionalProperties: false },
      fixtures: [{ name: "isolation", input: {}, expect: { code: 0, stdoutIncludes: "RO:true NET:true" } }],
    });
    const evaluation = await evaluateForgeCandidate({ candidate, knownTools: new Map([["projects_list", "read"], ["sys_stats", "read"]]) });
    expect(evaluation.passed).toBe(true);
    expect(evaluation.sandboxImageId).toMatch(/^sha256:/);
    expect(await fs.lstat(path.join(project, "forge-escape.txt")).catch(() => null)).toBeNull();
  });

});
