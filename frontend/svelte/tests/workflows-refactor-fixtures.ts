// Fixtures for workflows-refactor.test.ts. Kept beside the test so the test
// file stays inside the repository's 220-line physical line ratchet.
import type { WorkflowRunSummary } from "../src/lib/workflows/workflows-api.ts";

export const fullServerGraph = {
  version: 2,
  id: "wf-prod-1",
  name: "Deploy Verify",
  description: "Checks host health and posts alerts",
  status: "active",
  inputs: {},
  nodes: [
    { id: "cron-1", name: "Cron Schedule", type: "schedule", position: { x: 40, y: 120 }, config: { mode: "cron", cron: "*/15 * * * *", timezone: "UTC" } },
    { id: "host-1", name: "Host Check", type: "tool", position: { x: 300, y: 120 }, config: { kind: "host", tool: "sys_stats" } },
    { id: "alert-1", name: "Notify Ops", type: "channel_send", position: { x: 560, y: 120 }, config: { channelId: "ops", text: "ok" } },
  ],
  edges: [
    { id: "e-1", source: "cron-1", target: "host-1" },
    { id: "e-2", source: "host-1", target: "alert-1" },
  ],
  metadata: { tags: ["ops", "cron"], folder: "infra", timezone: "UTC" },
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-21T00:00:00.000Z",
  revision: "a".repeat(64),
};

// Stub fixture normalization (matches browser.mjs minimal graph fixture)
export const stubServerGraph = {
  id: "wf-stub", name: "Stub", description: "Minimal fixture", status: "active",
  nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }], edges: [{ id: "e1" }, { id: "e2" }],
  metadata: { tags: ["ops"] }, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T01:00:00.000Z", revision: "r1",
};

export const sampleRunDetail = {
  id: "run-99", graphId: "wf-prod-1", graphRevision: "a".repeat(64), graphName: "Deploy Verify",
  state: "completed", startedAt: "2026-11-24T10:00:00.000Z", updatedAt: "2026-11-24T10:00:03.000Z",
  finishedAt: "2026-11-24T10:00:03.000Z", trigger: { type: "manual", receivedAt: "2026-11-24T10:00:00.000Z" },
  nodes: [{ id: "cron-1", name: "Cron Schedule", type: "schedule", state: "completed", durationMs: 12, logs: ["ok"] }],
};

export const failedRunSummary: WorkflowRunSummary = {
  id: "r1", graphId: "wf-prod-1", graphRevision: "rev", graphName: "Deploy Verify",
  state: "failed", startedAt: "2026-11-24T10:00:00.000Z", updatedAt: "2026-11-24T10:00:01.000Z",
  finishedAt: "2026-11-24T10:00:01.000Z", failedNodeId: "host-1", failedNodeName: "Host Check", triggerType: "manual",
};

export type StudioCall = { url: string; method?: string; body?: Record<string, unknown> };

export function createStudioFetcher(calls: StudioCall[]): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method: init?.method, body });
    if (url.includes("run_id=")) return Response.json(sampleRunDetail);
    if (init?.method === "GET") return Response.json({ graphs: [fullServerGraph] });
    const action = body?.action;
    if (action === "create" || action === "update" || action === "clone") return Response.json({ graph: fullServerGraph });
    if (action === "delete" || action === "run_delete") return Response.json({ deleted: true });
    if (action === "run" || action === "run_stop" || action === "run_retry") return Response.json(sampleRunDetail);
    return Response.json({ error: "unknown" }, { status: 400 });
  };
}
