import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CapabilityTool } from "@/lib/capabilities/tool";

vi.mock("@/lib/capabilities/execute", () => ({ executeCapabilityCall: async ({ tool, args, context }: { tool: CapabilityTool; args: Record<string, unknown>; context: never }) => {
  try { return { kind: "success", result: await tool.run(args, context) }; } catch (error) { return { kind: "error", message: error instanceof Error ? error.message : String(error) }; }
} }));
const dir = await mkdtemp(path.join(os.tmpdir(), "mso-org-routing-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(dir, "sessions");
process.env.OS_ORGANIZATION_STORE = path.join(dir, "organization.json");
process.env.OS_DEVICE_STORE = path.join(dir, "devices.json");
const devices = await import("@/lib/auth/device-store");
const org = await import("@/lib/agent/organization-store");
const graphs = await import("./graph-store");
const engine = await import("./graph-engine");
afterAll(async () => { delete process.env.OS_ORGANIZATION_STORE; await rm(dir, { recursive: true, force: true }); });

describe("workflow organization seat routing", () => {
  it("refuses a saved workflow after even an exec principal redirects its shared target", async () => {
    let chart = await org.getOrganizationChart();
    chart = await org.upsertOrganizationUnit(chart.revision, { id: "unit_drift", key: "drift", name: "Drift", kind: "division" });
    const seat = { id: "seat_drift", unitId: "unit_drift", name: "Executor", title: "Executor", role: "executor", state: "active", seatMode: "on_demand", target: { kind: "project-agent", project: "reviewed" } };
    chart = await org.upsertOrganizationSeat(chart.revision, seat, "exec");
    const graph = await graphs.createWorkflowGraph("binding-review-owner", { name: "Reviewed route", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", name: "Executor", type: "agent", position: { x: 100, y: 0 }, config: { orgSeatId: seat.id, message: "Work" } },
    ], edges: [{ id: "edge", source: "start", target: "agent" }] });
    await org.upsertOrganizationSeat(chart.revision, { ...seat, target: { kind: "project-agent", project: "redirected" } }, "exec");
    const invoke = vi.fn();
    const tool: CapabilityTool = { name: "project_agent_run", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: invoke };
    const started = await engine.startWorkflowGraph(graph, {}, "binding-drift-once", { principal: "binding-review-owner", actor: "binding-review-owner", sessionId: "session", scope: "exec" }, () => tool);
    const done = await engine.workflowGraphRunStatus("binding-review-owner", started.id, 5000);
    expect(done.state).toBe("failed"); expect(done.error).toContain("binding changed"); expect(invoke).not.toHaveBeenCalled();
  });
  it("routes an Agent node through the seat's project-agent binding", async () => {
    let chart = await org.getOrganizationChart();
    chart = await org.upsertOrganizationUnit(chart.revision, { id: "unit_product", key: "product", name: "Product", kind: "division" });
    chart = await org.upsertOrganizationSeat(chart.revision, { id: "seat_cto", unitId: "unit_product", name: "CTO", title: "CTO", role: "cto", state: "active", seatMode: "on_demand", target: { kind: "project-agent", project: "project-from-org" } }, "exec");
    const graph = await graphs.createWorkflowGraph("org-route-owner", { name: "Org route", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", name: "CTO", type: "agent", position: { x: 120, y: 0 }, config: { orgSeatId: "seat_cto", message: "Ship it", wait: true } },
      { id: "out", name: "Out", type: "output", position: { x: 240, y: 0 }, config: { value: { ok: true } } },
    ], edges: [{ id: "a", source: "start", target: "agent" }, { id: "b", source: "agent", target: "out" }] });
    let received: Record<string, unknown> | null = null;
    const tool: CapabilityTool = { name: "project_agent_run", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async (args) => { received = args; return { ok: true }; } };
    const context = { principal: "org-route-owner", actor: "org-route-owner", sessionId: "session", scope: "exec" as const };
    const started = await engine.startWorkflowGraph(graph, {}, "org-seat-once", context, (name) => name === tool.name ? tool : undefined);
    const done = await engine.workflowGraphRunStatus("org-route-owner", started.id, 5000);
    expect(done.state).toBe("completed");
    expect(received).toMatchObject({ project: "project-from-org", message: "Ship it", wait: true });
    expect(done.nodes.find((node) => node.id === "agent")?.logs.join(" ")).toContain("Organization seat CTO routed to project agent");
  });
  it("bridges a Web workflow principal to the same device's native Local Agent namespace", async () => {
    await devices.approveDevice("aabbccddeeff00112233445566778899", "fixture", "owner");
    let chart = await org.getOrganizationChart();
    chart = await org.upsertOrganizationSeat(chart.revision, { id: "seat_local", unitId: "unit_product", name: "Operator", title: "Operator", role: "operator", state: "active", seatMode: "on_demand", target: { kind: "local-agent", ref: "milo" } }, "exec");
    const graph = await graphs.createWorkflowGraph("web:aabbccddeeff00112233445566778899", { name: "Local route", description: "", status: "draft", inputs: {}, metadata: {}, nodes: [
      { id: "start-local", name: "Start", type: "manual", position: { x: 0, y: 0 }, config: {} },
      { id: "agent-local", name: "Operator", type: "agent", position: { x: 120, y: 0 }, config: { orgSeatId: "seat_local", message: "Inspect" } },
    ], edges: [{ id: "local-e", source: "start-local", target: "agent-local" }] });
    let seenPrincipal = "";
    const tool: CapabilityTool = { name: "local_agent_request", description: "fixture", scope: "exec", inputSchema: { type: "object", properties: {} }, run: async (_args, ctx) => { seenPrincipal = ctx.principal ?? ""; return { ok: true }; } };
    const context = { principal: "web:aabbccddeeff00112233445566778899", actor: "web:aabbccddeeff00112233445566778899", sessionId: "session", scope: "exec" as const };
    const started = await engine.startWorkflowGraph(graph, {}, "org-local-once", context, (name) => name === tool.name ? tool : undefined);
    const done = await engine.workflowGraphRunStatus("web:aabbccddeeff00112233445566778899", started.id, 5000);
    expect(done.state).toBe("completed"); expect(seenPrincipal).toBe(context.principal);
  });

});
