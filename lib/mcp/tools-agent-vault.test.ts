import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/host/agent-vault-api", () => ({ getAgentVault: mocks.get, syncAgentVault: mocks.sync }));
import { AGENT_VAULT_TOOLS } from "./tools-agent-vault";
import { allows } from "./scope";
describe("agent vault capability contract", () => {
  it("separates read and write scope and delegates both to the shared host facade", async () => {
    const [read, sync] = AGENT_VAULT_TOOLS;
    expect(read.scope).toBe("read"); expect(allows("read", sync.scope)).toBe(false);
    expect(sync.audit).toEqual({ action: "fs.write", targetArg: "project" });
    expect(sync.limit?.max).toBe(10); expect(sync.inputSchema.required).toContain("project");
    await read.run({ project: "fixture", note: "Snapshots/fixture.md" }, { scope: "read" });
    expect(mocks.get).toHaveBeenCalledWith("fixture", "Snapshots/fixture.md");
    await sync.run({ project: "fixture" }, { scope: "write" }); expect(mocks.sync).toHaveBeenCalledWith("fixture");
  });
});
