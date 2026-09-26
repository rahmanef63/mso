import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-project-surfaces-"));
const project = path.join(root, "project");
const worktrees = path.join(root, "worktrees");
await fs.mkdir(path.join(project, "src"), { recursive: true });
await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ name: "surface-isolation-fixture" }));
await fs.writeFile(path.join(project, ".gitignore"), ".mso/\n.agent/\n");
await fs.writeFile(path.join(project, "src/value.ts"), "export const value = 1;\n");
const git = (...args: string[]) => execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main"); git("config", "user.name", "MSO Test"); git("config", "user.email", "test@example.invalid");
git("add", "."); git("commit", "-qm", "initial");

const previous = {
  read: process.env.OS_FS_READ_ROOTS, write: process.env.OS_FS_WRITE_ROOTS,
  roots: process.env.OS_PROJECT_ROOTS, memory: process.env.OS_SKILL_MEMORY_STORE,
  worktrees: process.env.MSO_AGENT_WORKTREE_ROOT,
};

beforeAll(async () => {
  process.env.OS_FS_READ_ROOTS = root; process.env.OS_FS_WRITE_ROOTS = root;
  process.env.OS_PROJECT_ROOTS = root; process.env.OS_SKILL_MEMORY_STORE = path.join(root, "workflow-memory.json");
  process.env.MSO_AGENT_WORKTREE_ROOT = worktrees;
  const { resetWorkflowStoreCache } = await import("@/lib/workflow"); resetWorkflowStoreCache();
});
afterAll(async () => {
  const keys = { read:"OS_FS_READ_ROOTS", write:"OS_FS_WRITE_ROOTS", roots:"OS_PROJECT_ROOTS", memory:"OS_SKILL_MEMORY_STORE", worktrees:"MSO_AGENT_WORKTREE_ROOT" } as const;
  for (const [key, env] of Object.entries(keys)) {
    const value = previous[key as keyof typeof previous];
    if (value === undefined) delete process.env[env]; else process.env[env] = value;
  }
  const { resetWorkflowStoreCache } = await import("@/lib/workflow"); resetWorkflowStoreCache();
  await fs.rm(root, { recursive: true, force: true });
});

describe("isolated workflow project mutation surfaces", () => {
  it("refuses canonical source-facing project tools and permits the owned worktree target", async () => {
    const { LEARNING_TOOLS } = await import("./tools-learning");
    const { PROJECT_MCP_MANAGE_TOOLS } = await import("./tools-project-mcp-manage");
    const { PROJECT_ASSET_TOOLS } = await import("./tools-project-assets");
    const { PROJECT_MCP_TOOLS } = await import("./tools-project-mcp");
    const { PROJECT_RUNTIME_TOOLS } = await import("./tools-project-runtime");
    const { FLOW_TOOLS } = await import("./tools-flows");
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const actor = "mcp:project-surface-isolation";
    const started = await start.run({ intent:"change project source and verify it", project, affected_paths:["src/value.ts"] }, { actor, scope:"exec" }) as {
      workflow:{ id:string; orchestration?:{ workspacePath?:string } }
    };
    const workspace = started.workflow.orchestration?.workspacePath!;
    const context = { actor, workflowActor:actor, workflowId:started.workflow.id, principal:actor, sessionId:"session", scope:"exec" as const, capabilities:{} as never };
    const manage = PROJECT_MCP_MANAGE_TOOLS.find((tool) => tool.name === "project_mcp_manage")!;
    const asset = PROJECT_ASSET_TOOLS.find((tool) => tool.name === "project_asset_attach")!;
    const mcpCall = PROJECT_MCP_TOOLS.find((tool) => tool.name === "project_mcp_call")!;
    const projectAgent = PROJECT_RUNTIME_TOOLS.find((tool) => tool.name === "project_agent_run")!;
    const flowRun = FLOW_TOOLS.find((tool) => tool.name === "flow_run")!;
    const flowManage = FLOW_TOOLS.find((tool) => tool.name === "flow_manage")!;

    await expect(manage.run({ project, action:"delete", server:"demo", revision:"x" }, context)).rejects.toThrow(/source-isolated/i);
    await expect(asset.run({ project, artifact_id:"missing", relative_path:"assets/demo.json" }, context)).rejects.toThrow(/source-isolated/i);
    await expect(mcpCall.run({ project, server:"demo", tool:"write", arguments:{} }, context)).rejects.toThrow(/source-isolated/i);
    await expect(projectAgent.run({ project, message:"edit source", max_scope:"write" }, context)).rejects.toThrow(/source-isolated/i);
    await expect(flowRun.run({ project, flow:"cloudflare.dns.ensure", input:{}, idempotency_key:"surface-test" }, context)).rejects.toThrow(/source-isolated/i);
    await expect(flowManage.run({ project, flow:"custom", action:"delete", revision:"x" }, context)).rejects.toThrow(/source-isolated/i);

    const inspected = await manage.run({ project:workspace, action:"inspect" }, context) as { revision:string };
    await expect(manage.run({ project:workspace, action:"upsert", server:"demo", revision:inspected.revision, url:"https://example.com/mcp" }, context)).resolves.toMatchObject({ installationScope:"project" });
    expect(await fs.readFile(path.join(workspace, ".mcp.json"), "utf8")).toContain("example.com/mcp");
    await expect(fs.readFile(path.join(project, ".mcp.json"), "utf8")).rejects.toMatchObject({ code:"ENOENT" });
    expect(git("status", "--porcelain")).toBe("");
  });

  it("keeps ignored project knowledge and repo memory canonical without dirtying source", async () => {
    const { LEARNING_TOOLS } = await import("./tools-learning");
    const { PROJECT_STATE_TOOLS } = await import("./tools-project-state");
    const { PROJECT_MEMORY_TOOLS } = await import("./tools-project-memory");
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const actor = "mcp:private-project-state";
    const started = await start.run({ intent:"inspect source then preserve project evidence", project, affected_paths:["src/value.ts"] }, { actor, scope:"exec" }) as { workflow:{ id:string } };
    const context = { actor, workflowActor:actor, workflowId:started.workflow.id, scope:"write" as const };
    const knowledge = PROJECT_STATE_TOOLS.find((tool) => tool.name === "project_knowledge_set")!;
    const memory = PROJECT_MEMORY_TOOLS.find((tool) => tool.name === "project_memory_upsert")!;
    await expect(knowledge.run({ project, content:"# Private project context\n" }, context)).resolves.toMatchObject({ path:".mso/KNOWLEDGE.md" });
    await expect(memory.run({ project, kind:"test", title:"Private evidence", summary:"Preserved outside source history." }, context)).resolves.toMatchObject({ kind:"test" });
    expect(git("status", "--porcelain")).toBe("");
  });
});
