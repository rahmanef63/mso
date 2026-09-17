import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tools-agent-p1-"));
process.env.OS_AGENT_MEMORY_DIR = root;
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_FS_WRITE_ROOTS = root;
afterAll(async () => { delete process.env.OS_AGENT_MEMORY_DIR; delete process.env.OS_AGENT_SESSIONS_DIR; delete process.env.OS_FS_WRITE_ROOTS; await fs.rm(root, { recursive: true, force: true }); });
vi.resetModules();
const { AGENT_TOOLS } = await import("./tools-agent");

function tool(name: string) {
  const found = AGENT_TOOLS.find((row) => row.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("typed MCP agent memory tools", () => {
  it("hashes conversation provenance and exposes typed conflict evidence without the raw session id", async () => {
    const context = { principal: "mcp-client:test", sessionId: "raw-openai-conversation-id-must-not-persist", scope: "exec" as const };
    await tool("agent_memory_remember").run({ document: "MEMORY.md", key: "Region", value: "Singapore", mode: "claim", confidence: 0.9 }, context);
    await tool("agent_memory_remember").run({ document: "MEMORY.md", key: "Region", value: "Jakarta", mode: "claim", confidence: 0.8 }, context);
    const result = await tool("agent_memory_search").run({ query: "region" }, context) as { records: Array<{ record: { provenance: { sessionHash?: string } }, conflicts: unknown[] }> };
    expect(result.records).toHaveLength(1);
    expect(result.records[0].conflicts).toHaveLength(1);
    expect(result.records[0].record.provenance.sessionHash).toMatch(/^[a-f0-9]{24}$/);
    const persisted = (await Promise.all((await fs.readdir(root, { withFileTypes: true })).filter((row) => row.isDirectory()).map(async (row) => fs.readFile(path.join(root, row.name, "records-v1.json"), "utf8"))))[0];
    expect(persisted).not.toContain(context.sessionId);
  });

  it("validates typed metadata instead of accepting arbitrary labels", async () => {
    const context = { principal: "mcp-client:bad", sessionId: "session", scope: "exec" as const };
    expect(() => tool("agent_memory_remember").run({ document: "MEMORY.md", key: "x", value: "y", kind: "graph" }, context)).toThrow(/kind must be one of/);
  });
});


describe("semantic session resolver tools", () => {
  it("resolves stable human refs owner-safely without exposing internal session ids or secrets", async () => {
    const store = await import("@/lib/agent/session-store");
    const principal = "mcp-client:flow-owner";
    const project = path.join(root, "project");
    await fs.mkdir(path.join(project, "src"), { recursive: true });
    await fs.writeFile(path.join(project, "src", "app.ts"), "export const password=secret-value;\n", "utf8");
    const session = await store.createAgentSession(principal, "mcp", { title: "Semantic resolver", cwd: project });
    await store.appendAgentSessionEvent(principal, session.id, { kind: "tool", tool: "fs_read", state: "completed", detail: "src/app.ts token=secret-value" });
    await store.appendAgentSessionEvent(principal, session.id, { kind: "tool", tool: "fs_write", state: "completed", detail: "src/app.ts" });
    const context = { principal, sessionId: session.id, scope: "exec" as const };
    const flow = await tool("agent_session_flow").run({ session_ref: `@${session.name}` }, context) as { steps: Array<{ actions: Array<{ ref: string; tool?: string }> }> };
    const actionRef = flow.steps.flatMap((step) => step.actions).find((action) => action.tool === "fs_read")?.ref;
    expect(actionRef).toMatch(/^S\d+\.A\d+$/);
    const resolved = await tool("agent_session_action_resolve").run({ session_ref: `@${session.name}`, action_ref: actionRef }, context);
    const body = JSON.stringify(resolved);
    expect(body).not.toContain(session.id);
    expect(body).not.toContain("secret-value");
    expect(body).toContain("[redacted]");
    const writeRef = flow.steps.flatMap((step) => step.actions).find((action) => action.tool === "fs_write")?.ref;
    const historical = await tool("agent_session_action_resolve").run({ session_ref: `@${session.name}`, action_ref: writeRef, artifact_view: "snapshot" }, context);
    const historicalBody = JSON.stringify(historical);
    expect(historicalBody).toContain("artifactHistory");
    expect(historicalBody).toContain("previewRedacted");
    expect(historicalBody).not.toContain("password=secret-value");
    await expect(tool("agent_session_action_resolve").run({ session_ref: `@${session.name}`, action_ref: actionRef }, { ...context, principal: "mcp-client:other" })).rejects.toThrow(/not found|session/i);
  });
});
