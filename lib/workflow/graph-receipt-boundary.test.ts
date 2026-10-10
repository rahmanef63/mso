import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { DeviceRole } from "@/lib/auth/roles";
import type { CapabilityTool } from "@/lib/capabilities/tool";
let role: DeviceRole | null = "owner";
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: async () => role ? { role } : null }));
import { createWorkflowGraph, workflowGraphOwner } from "./graph-store";
import { requestWorkflowGraphStop, startWorkflowGraph, workflowGraphRunStatus } from "./graph-engine";
import { listWorkflowGraphRuns, readWorkflowGraphRun, writeWorkflowGraphRun } from "./graph-run-store";
import * as runStore from "./graph-run-store";
import { requireWorkflowReceiptAuthority } from "./graph-authority";
const principal = "web:11223344556677889900aabbccddeeff";
const context = { principal, actor: principal, sessionId: "fixture", scope: "exec" as const };
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "mso-receipt-boundary-")); role = "owner"; vi.stubEnv("OS_AGENT_SESSIONS_DIR", dir); vi.stubEnv("OS_MCP_MAX_SCOPE", "exec"); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
async function graph(name: string) {
  return createWorkflowGraph(principal, { name, description: "", status: "draft", inputs: {}, metadata: {}, nodes: [{ id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} }, { id: "out", name: "Result", type: "output", position: { x: 100, y: 0 }, config: { value: "fixture-private-output" } }], edges: [{ id: "edge", source: "start", target: "out" }] });
}
describe("workflow receipt identity and creation authority", () => {
  it("refreshes a running snapshot after its execution has already finished", async () => {
    const started = await startWorkflowGraph(await graph("Fast completion"), {}, "fast-key", context, () => undefined);
    const runtime = globalThis as typeof globalThis & { msoGraphPending?: Map<string, Promise<void>> };
    await runtime.msoGraphPending?.get(started.id);
    const completed = (await readWorkflowGraphRun(workflowGraphOwner(principal), started.id))!;
    expect(completed.state).toBe("completed");
    expect(runtime.msoGraphPending?.has(started.id)).toBe(false);
    // A file read can capture the running receipt just before authority checking yields.
    const read = vi.spyOn(runStore, "readWorkflowGraphRun").mockResolvedValueOnce({ ...completed, state: "running" });
    expect((await workflowGraphRunStatus(principal, started.id, 5000)).state).toBe("completed");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("rechecks authority after a waited execution finishes", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    const tool: CapabilityTool = { name: "fixture_wait", description: "fixture", scope: "read", inputSchema: { type: "object", properties: {} }, run: async () => { entered = true; await pending; return "fixture-private-output"; } };
    const saved = await graph("Waited");
    saved.nodes[1] = { ...saved.nodes[1], type: "tool", config: { tool: tool.name, args: {} } };
    const started = await startWorkflowGraph(saved, {}, "waited-key", context, () => tool);
    await vi.waitFor(() => expect(entered).toBe(true));
    const waited = workflowGraphRunStatus(principal, started.id, 5000);
    await new Promise(resolve => setImmediate(resolve));
    role = "viewer"; release();
    await expect(waited).rejects.toThrow(/original execution authority/);
    role = "owner"; await workflowGraphRunStatus(principal, started.id, 5000);
  });
  it("separates sibling graphs and trigger nodes while preserving exact retries", async () => {
    const first = await graph("First"), second = await graph("Second");
    const a = await startWorkflowGraph(first, {}, "shared-key", context, () => undefined);
    const b = await startWorkflowGraph(second, {}, "shared-key", context, () => undefined);
    expect(b.id).not.toBe(a.id);
    expect((await workflowGraphRunStatus(principal, a.id, 5000)).state).toBe("completed");
    expect((await workflowGraphRunStatus(principal, b.id, 5000)).state).toBe("completed");
    expect((await startWorkflowGraph(first, {}, "shared-key", context, () => undefined)).id).toBe(a.id);
    await expect(startWorkflowGraph(first, { changed: true }, "shared-key", context, () => undefined)).rejects.toThrow(/different graph\/input\/revision/);
    await expect(startWorkflowGraph({ ...first, revision: "changed-revision" }, {}, "shared-key", context, () => undefined)).rejects.toThrow(/different graph\/input\/revision/);
    const trigger = await startWorkflowGraph(first, {}, "shared-key", context, () => undefined, principal, { type: "manual", nodeId: "out", receivedAt: new Date().toISOString() });
    expect(trigger.id).not.toBe(a.id); await workflowGraphRunStatus(principal, trigger.id, 5000);
  });
  it("keeps legacy receipt IDs addressable and reuses only the matching graph", async () => {
    const first = await graph("Legacy"), second = await graph("Other");
    const started = await startWorkflowGraph(first, {}, "migration-key", context, () => undefined);
    await workflowGraphRunStatus(principal, started.id, 5000);
    const owner = workflowGraphOwner(principal), stored = (await readWorkflowGraphRun(owner, started.id))!;
    const legacyId = createHash("sha256").update(`${owner}:old-key`).digest("hex").slice(0, 32);
    const legacy = { ...stored, id: legacyId, idempotencyKey: "old-key", executionScope: undefined };
    await writeWorkflowGraphRun(legacy);
    expect((await startWorkflowGraph(first, {}, "old-key", context, () => undefined)).id).toBe(legacyId);
    const other = await startWorkflowGraph(second, {}, "old-key", context, () => undefined);
    expect(other.id).not.toBe(legacyId);
    await workflowGraphRunStatus(principal, other.id, 5000);
    await workflowGraphRunStatus(principal, legacyId);
  });
  it("refuses Owner-era outputs, stop and retry authority after demotion or revoke", async () => {
    const started = await startWorkflowGraph(await graph("Private"), {}, "private-key", context, () => undefined);
    await workflowGraphRunStatus(principal, started.id, 5000);
    const receipt = (await readWorkflowGraphRun(workflowGraphOwner(principal), started.id))!;
    expect(receipt.executionScope).toBe("exec");
    for (const next of ["operator", "viewer"] as const) {
      role = next;
      await expect(workflowGraphRunStatus(principal, started.id)).rejects.toThrow(/original execution authority/);
      await expect(requestWorkflowGraphStop(principal, started.id)).rejects.toThrow(/original execution authority/);
      await expect(requireWorkflowReceiptAuthority(principal, receipt)).rejects.toThrow(/original execution authority/);
      expect(JSON.stringify(await listWorkflowGraphRuns(workflowGraphOwner(principal)))).not.toContain("fixture-private-output");
    }
    role = "owner"; expect((await workflowGraphRunStatus(principal, started.id)).nodes.find(node => node.id === "out")?.output).toEqual({ text: "fixture-private-output" });
    await expect(workflowGraphRunStatus(principal, started.id, 0, "read")).rejects.toThrow(/original execution authority/);
    role = null; await expect(workflowGraphRunStatus(principal, started.id)).rejects.toThrow(/revoked/);
  });
  it("keeps even read-scoped Owner receipts private after demotion", async () => {
    const started = await startWorkflowGraph(await graph("Read only"), {}, "read-key", { ...context, scope: "read" }, () => undefined);
    await workflowGraphRunStatus(principal, started.id, 5000);
    for (const next of ["operator", "viewer"] as const) {
      role = next;
      await expect(workflowGraphRunStatus(principal, started.id)).rejects.toThrow(/original execution authority/);
    }
  });
  it("preserves an Operator's own receipt without exposing it after Viewer demotion", async () => {
    role = "operator";
    const started = await startWorkflowGraph(await graph("Operator"), {}, "operator-key", { ...context, scope: "write" }, () => undefined);
    expect((await workflowGraphRunStatus(principal, started.id, 5000)).executionRole).toBe("operator");
    role = "viewer";
    await expect(workflowGraphRunStatus(principal, started.id)).rejects.toThrow(/original execution authority/);
  });
});
