import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-source-isolation-"));
const project = path.join(root, "project");
const worktrees = path.join(root, "worktrees");
await fs.mkdir(path.join(project, "src"), { recursive: true });
await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ name: "source-isolation-fixture" }));
await fs.writeFile(path.join(project, "src/value.ts"), "export const value = 1;\n");
const git = (...args: string[]) => execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main"); git("config", "user.name", "MSO Test"); git("config", "user.email", "test@example.invalid");
git("add", "."); git("commit", "-qm", "initial");

const previous = {
  read: process.env.OS_FS_READ_ROOTS,
  write: process.env.OS_FS_WRITE_ROOTS,
  projectRoots: process.env.OS_PROJECT_ROOTS,
  memory: process.env.OS_SKILL_MEMORY_STORE,
  worktrees: process.env.MSO_AGENT_WORKTREE_ROOT,
};

beforeAll(async () => {
  process.env.OS_FS_READ_ROOTS = root;
  process.env.OS_FS_WRITE_ROOTS = root;
  process.env.OS_PROJECT_ROOTS = root;
  process.env.OS_SKILL_MEMORY_STORE = path.join(root, "workflow-memory.json");
  process.env.MSO_AGENT_WORKTREE_ROOT = worktrees;
  const { resetWorkflowStoreCache } = await import("@/lib/workflow"); resetWorkflowStoreCache();
});

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key === "read" ? "OS_FS_READ_ROOTS" : key === "write" ? "OS_FS_WRITE_ROOTS" : key === "projectRoots" ? "OS_PROJECT_ROOTS" : key === "memory" ? "OS_SKILL_MEMORY_STORE" : "MSO_AGENT_WORKTREE_ROOT"];
    else process.env[key === "read" ? "OS_FS_READ_ROOTS" : key === "write" ? "OS_FS_WRITE_ROOTS" : key === "projectRoots" ? "OS_PROJECT_ROOTS" : key === "memory" ? "OS_SKILL_MEMORY_STORE" : "MSO_AGENT_WORKTREE_ROOT"] = value;
  }
  const { resetWorkflowStoreCache } = await import("@/lib/workflow"); resetWorkflowStoreCache();
  await fs.rm(root, { recursive: true, force: true });
});

describe("workflow_start source isolation", () => {
  it("creates a task-owned worktree and blocks canonical fs/shell mutation", async () => {
    const { LEARNING_TOOLS } = await import("./tools-learning");
    const { MUTATE_TOOLS } = await import("./tools-mutate");
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const write = MUTATE_TOOLS.find((tool) => tool.name === "fs_write")!;
    const exec = MUTATE_TOOLS.find((tool) => tool.name === "exec_run")!;
    const actor = "mcp:source-isolation";
    const started = await start.run({
      intent: "fix the source value and verify the repository",
      project,
      affected_paths: ["src/value.ts"],
    }, { actor, scope: "exec" }) as {
      workflow: { id: string; project?: string; orchestration?: { isolation: string; workspacePath?: string; baseCommit?: string } };
      bootstrap: { trace: string[]; policy: { workspace?: string } };
    };
    const workspace = started.workflow.orchestration?.workspacePath;
    expect(started.workflow.project).toBe(project);
    expect(started.workflow.orchestration).toMatchObject({ isolation: "isolated-worktree", baseCommit: git("rev-parse", "HEAD") });
    expect(workspace).toBeTruthy(); expect(workspace).not.toBe(project); expect(workspace!.startsWith(worktrees + path.sep)).toBe(true);
    expect(started.bootstrap.trace).toEqual(expect.arrayContaining([expect.stringContaining("[Workspace] task-owned worktree")]));
    expect(started.bootstrap.policy.workspace).toContain(workspace!);

    const context = { actor, workflowActor: actor, workflowId: started.workflow.id, scope: "exec" as const };
    await expect(write.run({ path: path.join(project, "src/value.ts"), content: "export const value = 2;\n" }, context)).rejects.toThrow(/source-isolated/i);
    await expect(exec.run({ command: "git status --short", cwd: project }, context)).rejects.toThrow(/exec cwd/i);
    await expect(exec.run({ command: "git status --short" }, context)).rejects.toThrow(/exec requires cwd/i);

    await expect(write.run({ path: path.join(workspace!, "src/value.ts"), content: "export const value = 2;\n" }, context)).resolves.toMatchObject({ ok: true });
    const shell = await exec.run({ command: "git status --short", cwd: workspace }, context) as { code: number; stdout: string };
    expect(shell.code).toBe(0); expect(shell.stdout).toContain("src/value.ts");
    expect(await fs.readFile(path.join(project, "src/value.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(await fs.readFile(path.join(workspace!, "src/value.ts"), "utf8")).toBe("export const value = 2;\n");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("auto-removes only an unused clean task worktree when the workflow is cancelled", async () => {
    const { LEARNING_TOOLS } = await import("./tools-learning");
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const cancel = LEARNING_TOOLS.find((tool) => tool.name === "workflow_cancel")!;
    const actor = "mcp:source-isolation-clean";
    const started = await start.run({
      intent: "fix one source line then stop if no change is needed", project, affected_paths: ["src/value.ts"],
    }, { actor, scope: "exec" }) as { workflow: { id: string; orchestration?: { workspacePath?: string } } };
    const workspace = started.workflow.orchestration?.workspacePath!;
    expect(workspace).not.toBe(project);
    const result = await cancel.run({ workflow_id: started.workflow.id, reason: "no source change required" }, {
      actor, workflowActor: actor, scope: "exec",
    }) as { cleanup: { autoRemoved?: boolean; worktreeCleanupRequired: boolean } };
    expect(result.cleanup).toMatchObject({ autoRemoved: true, worktreeCleanupRequired: false });
    await expect(fs.lstat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
