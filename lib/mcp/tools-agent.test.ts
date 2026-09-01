import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tools-agent-p1-"));
process.env.OS_AGENT_MEMORY_DIR = root;
afterAll(async () => { delete process.env.OS_AGENT_MEMORY_DIR; await fs.rm(root, { recursive: true, force: true }); });
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
