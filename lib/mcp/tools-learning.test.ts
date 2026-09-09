import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-bootstrap-"));
const project = path.join(dir, "mso");
await fs.mkdir(project);
await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
  name: "mso", version: "9.9.9", scripts: { test: "vitest", build: "next build" },
}));
// A skill living inside a DIFFERENT project than the one the workflow names. The
// bootstrap search must still find it: capability discovery is global, and an agent
// that can only see the current project's skills relearns what the box already knows.
const sibling = path.join(dir, "orchard");
await fs.mkdir(path.join(sibling, ".claude/skills/orchard-harvest"), { recursive: true });
await fs.writeFile(
  path.join(sibling, ".claude/skills/orchard-harvest/SKILL.md"),
  "---\nname: orchard-harvest\ndescription: Harvest and verify the orchard dataset export.\n---\n\n# Orchard harvest\n",
);

const previous = {
  read: process.env.OS_FS_READ_ROOTS,
  write: process.env.OS_FS_WRITE_ROOTS,
  memory: process.env.OS_SKILL_MEMORY_STORE,
};
process.env.OS_FS_READ_ROOTS = dir;
process.env.OS_FS_WRITE_ROOTS = dir;
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const { resetWorkflowStoreCache } = await import("@/lib/workflow");
const { projectRefFor } = await import("@/lib/skills/project-skills");
const { LEARNING_TOOLS } = await import("./tools-learning");

/** The root-qualified id the catalog assigns, computed the same way it does. */
const siblingSkillId = async () =>
  `${projectRefFor(sibling, await fs.realpath(dir)).id}/orchard-harvest`;

describe("workflow_start bootstrap", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    resetWorkflowStoreCache();
  });
  afterAll(async () => {
    if (previous.read === undefined) delete process.env.OS_FS_READ_ROOTS;
    else process.env.OS_FS_READ_ROOTS = previous.read;
    if (previous.write === undefined) delete process.env.OS_FS_WRITE_ROOTS;
    else process.env.OS_FS_WRITE_ROOTS = previous.write;
    if (previous.memory === undefined) delete process.env.OS_SKILL_MEMORY_STORE;
    else process.env.OS_SKILL_MEMORY_STORE = previous.memory;
    resetWorkflowStoreCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns project, toolset, skill search and an executable trace in one call", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start");
    expect(start).toBeDefined();
    const result = await start!.run({
      intent: "inspect and safely update the MSO repository, then verify it",
      project,
      constraints: "no production downtime",
    }, { actor: "mcp:test-bootstrap", scope: "write" }) as {
      workflow: { project?: string };
      bootstrap: {
        ready: boolean;
        project: { path: string; matchedBy: string };
        repository: { package: { name?: string; version?: string; scripts: string[] }; git: { statusChecked: boolean } };
        toolset: { toolCount: number; names: string[]; hash: string };
        trace: string[];
      };
      search: { hits: Array<{ kind: string; name: string; trust?: string }> };
    };

    expect(result.workflow.project).toBe(project);
    expect(result.bootstrap).toMatchObject({
      ready: true,
      project: { path: project, matchedBy: "path" },
      repository: { package: { name: "mso", version: "9.9.9", scripts: ["test", "build"] }, git: { statusChecked: false } },
    });
    expect(result.bootstrap.toolset.toolCount).toBeGreaterThan(10);
    expect(result.bootstrap.toolset.names).toContain("workflow_start");
    expect(result.bootstrap.toolset.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.bootstrap.trace).toEqual(expect.arrayContaining([
      expect.stringContaining("[MSO]"),
      expect.stringContaining("[Project]"),
      expect.stringContaining("[Plan]"),
    ]));
    expect(result.search.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "skill", name: "mso-repo-work", trust: "official" }),
    ]));
  });

  it("searches skills from EVERY project, not just the one the workflow names", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const result = await start.run({
      intent: "harvest and verify the orchard dataset export",
      project, // deliberately the OTHER project
    }, { actor: "mcp:global-skills", scope: "write" as const }) as {
      search: { hits: Array<{ kind: string; id: string; name: string; trust?: string; project?: { name: string } }> };
    };
    expect(result.search.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "skill", id: await siblingSkillId(), name: "orchard-harvest",
        trust: "local", project: expect.objectContaining({ name: "orchard", path: sibling }),
      }),
    ]));
  });

  it("tells the client when the discovery scan was incomplete", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const result = await start.run({ intent: "check discovery completeness", project }, {
      actor: "mcp:discovery", scope: "write" as const,
    }) as { bootstrap: { discovery: { complete: boolean; catalog: { truncated: boolean; truncationReasons: string[] } }; trace: string[] } };
    // This fixture fits well inside every cap, so the honest answer is "complete" —
    // and the trace carries no partial-scan warning.
    expect(result.bootstrap.discovery.complete).toBe(true);
    expect(result.bootstrap.discovery.catalog.truncated).toBe(false);
    expect(result.bootstrap.trace.some((line) => line.startsWith("[Discovery]"))).toBe(false);
  });

  it("supports parallel conversations and exposes explicit cancel/finish ids", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const cancel = LEARNING_TOOLS.find((tool) => tool.name === "workflow_cancel")!;
    const finish = LEARNING_TOOLS.find((tool) => tool.name === "workflow_finish")!;
    const context = { actor: "mcp:shared-bootstrap", scope: "write" as const };
    const first = await start.run({ intent: "first workflow", project }, context) as {
      workflow: { id: string }; activeWorkflowCount: number;
    };
    const second = await start.run({ intent: "second workflow", project }, context) as {
      workflow: { id: string }; activeWorkflowCount: number;
    };
    expect(first.workflow.id).not.toBe(second.workflow.id);
    expect(second.activeWorkflowCount).toBe(2);
    expect(cancel.inputSchema.required).toContain("workflow_id");
    expect(finish.inputSchema.required).toEqual(expect.arrayContaining(["workflow_id", "summary", "success"]));
    await expect(finish.run({ workflow_id: "wrong", summary: "wrong", success: true }, context))
      .rejects.toThrow("workflow_id was not found");

    await expect(cancel.run({ workflow_id: first.workflow.id, reason: "interrupted" }, context))
      .resolves.toMatchObject({ workflow: { id: first.workflow.id }, reason: "interrupted" });
    await expect(finish.run({
      workflow_id: second.workflow.id, summary: "verified", success: true,
    }, context)).resolves.toMatchObject({ workflow: { id: second.workflow.id } });
  });


  it("does not retain an opaque workflow when bootstrap preflight fails", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const context = { actor: "mcp:preflight", scope: "write" as const };
    await expect(start.run({ intent: "", project }, context)).rejects.toThrow("intent");
    const { activeWorkflowForActor } = await import("@/lib/workflow");
    await expect(activeWorkflowForActor(context.actor)).resolves.toBeNull();
  });

});
