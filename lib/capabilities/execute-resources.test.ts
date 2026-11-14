import { beforeEach, describe, expect, it, vi } from "vitest";

// The kernel imports a lot of telemetry that is irrelevant here; only the ledger
// wiring is under test, so the side channels are stubbed rather than exercised.
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
vi.mock("@/lib/host/fs-api", () => ({ withIsolatedFilesystem: <T>(_root: string | undefined, fn: () => Promise<T>) => fn() }));
vi.mock("@/lib/agent/session-store", () => ({ maybeAutoTitleAgentSession: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent/local-agent-presence", () => ({ touchLocalAgentPresence: vi.fn(async () => undefined) }));
vi.mock("@/lib/workflow", () => ({
  activeWorkflowForActor: vi.fn(async () => null),
  recordWorkflowStep: vi.fn(async () => undefined),
  replayHandlesFromResult: vi.fn(() => []),
}));
vi.mock("@/lib/capabilities/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capabilities/activity")>()),
  recordCapabilityActivity: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tenancy/capability", () => ({ tenantCapabilityPlan: vi.fn(async () => null) }));

import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { aggregateSliceUsage, resetSliceLedger, sliceUsageSamples } from "@/lib/resources/ledger";
import type { CapabilityTool } from "@/lib/capabilities/tool";

const tool = (name: string, run: CapabilityTool["run"] = async () => ({ ok: true })): CapabilityTool => ({
  name,
  description: "test tool",
  scope: "read",
  inputSchema: { type: "object", properties: {} },
  run,
});

beforeEach(() => resetSliceLedger());

describe("capability executor resource measurement", () => {
  it("records a measured sample for a call whose slice is attributed", async () => {
    await executeCapabilityCall({ tool: tool("workflow_graph"), args: {}, scope: "read" });
    const samples = sliceUsageSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ slice: "workflows", tool: "workflow_graph", concurrent: 1 });
    expect(samples[0].wallMs).toBeGreaterThanOrEqual(0);
    expect(samples[0].cpuMs).toBeGreaterThanOrEqual(0);
    expect(samples[0].resultBytes).toBe(Buffer.byteLength(JSON.stringify({ ok: true }), "utf8"));
  });

  it("records an unattributed call as unaccounted instead of guessing a slice", async () => {
    await executeCapabilityCall({ tool: tool("fs_read"), args: {}, scope: "read" });
    expect(sliceUsageSamples()[0].slice).toBeNull();
    expect(aggregateSliceUsage().buckets.find((bucket) => bucket.slice === "")?.calls).toBe(1);
  });

  it("records a failed call too, since a failure still consumed process time", async () => {
    const outcome = await executeCapabilityCall({
      tool: tool("workflow_graph", async () => { throw new Error("boom"); }),
      args: {},
      scope: "read",
    });
    expect(outcome.kind).toBe("error");
    const samples = sliceUsageSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].slice).toBe("workflows");
    expect(samples[0].resultBytes).toBe(0);
  });

  it("counts concurrent in-flight calls for the same slice", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = executeCapabilityCall({
      tool: tool("workflow_graph", async () => { await gate; return { ok: true }; }),
      args: {},
      scope: "read",
    });
    // A second call to the same slice observes the first one still in flight.
    await executeCapabilityCall({ tool: tool("flow_run"), args: {}, scope: "read" });
    release?.();
    await slow;
    const peaks = sliceUsageSamples().map((sample) => sample.concurrent);
    expect(Math.max(...peaks)).toBe(2);
  });

  it("still returns the call's own outcome regardless of instrumentation", async () => {
    const outcome = await executeCapabilityCall({ tool: tool("org_tool_not_registered"), args: {}, scope: "read" });
    expect(outcome.kind).toBe("success");
    expect(aggregateSliceUsage().buckets).toHaveLength(1);
  });
});
