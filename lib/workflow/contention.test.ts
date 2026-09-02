import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-contention-memory-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const memory = await import("./index");

const orchestration = (affectedPaths: string[], reservedResources: string[]) => ({
  risk: "medium" as const,
  complexity: "medium" as const,
  contention: "none" as const,
  memoryRelevance: "medium" as const,
  isolation: "optional-worktree" as const,
  verification: "affected" as const,
  reasons: ["contained feature"],
  sharedResourceWarnings: [],
  changedPaths: [],
  affectedPaths,
  reservedResources,
  overlappingPaths: [],
  overlappingResources: [],
  activeProjectWorkflows: 0,
  conflictingWorkflowCount: 0,
  memoryHits: 0,
  contextEstimateTokens: 20,
  cleanupState: "pending" as const,
  workspacePath: "/repo",
  createdAt: new Date().toISOString(),
});

describe("workflow scope collision metadata", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    memory.resetWorkflowStoreCache();
  });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("detects overlapping path scopes and reserved shared resources before merge conflict", async () => {
    const first = await memory.startWorkflow({
      actor: "mcp:first",
      intent: "update auth flow",
      project: "/repo",
      orchestration: orchestration(["src/auth"], ["port:4173", "database:development"]),
    });

    await expect(memory.summarizeProjectContention(
      "/repo",
      ["src/auth/session.ts"],
      ["database:development"],
    )).resolves.toMatchObject({
      activeWorkflowCount: 1,
      conflictingWorkflowCount: 1,
      overlappingPaths: ["src/auth/session.ts"],
      overlappingResources: ["database:development"],
    });

    await expect(memory.summarizeProjectContention(
      "/repo",
      ["src/builder"],
      ["port:9000"],
    )).resolves.toMatchObject({
      activeWorkflowCount: 1,
      conflictingWorkflowCount: 0,
      overlappingPaths: [],
      overlappingResources: [],
    });

    await memory.cancelWorkflow({ actor: "mcp:first", workflowId: first.workflow.id });
  });

  it("does not expose another workflow actor or intent in the contention summary", async () => {
    await memory.startWorkflow({
      actor: "mcp:private-owner",
      intent: "private internal task description",
      project: "/repo",
      orchestration: orchestration(["src/shared"], ["queue:jobs"]),
    });
    const result = await memory.summarizeProjectContention("/repo", ["src/shared/file.ts"], ["queue:jobs"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-owner");
    expect(serialized).not.toContain("private internal task description");
  });
});
