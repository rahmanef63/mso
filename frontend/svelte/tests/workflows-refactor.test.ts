import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  bezierEdgePath,
  clampZoom,
  computeFitViewport,
  computeLayoutPreview,
  inputPortPos,
  outputPortPos,
  runStateStroke,
  synthesizeStudioGraph,
  tidyGraphNodes,
  wouldCreateCycle,
} from "../src/lib/workflows/workflow-canvas-math.ts";
import {
  addNodeToDraft,
  connectEdgeInDraft,
  draftFromDetail,
  isDraftDirty,
  moveNodeInDraft,
  removeEdgeFromDraft,
  removeNodeFromDraft,
  tidyDraftLayout,
  updateEdgeInDraft,
  updateNodeInDraft,
} from "../src/lib/workflows/workflow-draft.ts";
import {
  cloneWorkflowGraphApi,
  createWorkflowGraphApi,
  deleteWorkflowGraphApi,
  deleteWorkflowRunApi,
  normalizeGraphDetail,
  readWorkflowGraphDetails,
  readWorkflowRunDetailApi,
  retryWorkflowRunApi,
  runWorkflowGraphApi,
  stopWorkflowRunApi,
  summaryFromDetail,
  updateWorkflowGraphApi,
} from "../src/lib/workflows/workflow-studio-api.ts";
import {
  filterGraphDetails,
  filterRunSummaries,
  formatDurationMs,
  runNodeStateMap,
} from "../src/lib/workflows/workflow-studio-helpers.ts";
import {
  configFieldsForNode,
  WORKFLOW_PALETTE_ITEMS,
  WORKFLOW_STARTER_TEMPLATES,
} from "../src/lib/workflows/workflow-templates.ts";
import { ApiError } from "../src/lib/workflows/workflows-api.ts";
import {
  createStudioFetcher, failedRunSummary, fullServerGraph, stubServerGraph, type StudioCall,
} from "./workflows-refactor-fixtures.ts";

const signal = new AbortController().signal;
const workflowDir = new URL("../src/lib/workflows/", import.meta.url);

test("starter templates and palette cover all required workflow studio nodes and valid DAGs", () => {
  const tplIds = WORKFLOW_STARTER_TEMPLATES.map((t) => t.id);
  assert.ok(tplIds.includes("webhook-transform-notify"));
  assert.ok(tplIds.includes("cron-host-alert"));
  assert.ok(tplIds.includes("manual-agent-write"));
  assert.ok(tplIds.includes("blank"));

  for (const tpl of WORKFLOW_STARTER_TEMPLATES) {
    const built = tpl.build();
    assert.ok(built.nodes.length >= 2, `${tpl.id} must have >= 2 nodes`);
    assert.ok(built.edges.length >= 1, `${tpl.id} must have >= 1 edge`);
    const ids = new Set(built.nodes.map((n) => n.id));
    for (const edge of built.edges) {
      assert.equal(ids.has(edge.source), true);
      assert.equal(ids.has(edge.target), true);
    }
  }

  const badges = new Set(WORKFLOW_PALETTE_ITEMS.map((item) => item.badge));
  for (const expected of ["Manual", "Webhook", "Cron", "HTTP", "Host", "AI Agent", "Branch", "Transform", "Delay", "Notify"]) {
    assert.equal(badges.has(expected), true, `Palette missing ${expected}`);
  }
  assert.ok(configFieldsForNode("webhook").length > 0);
  assert.ok(configFieldsForNode("schedule").length > 0);
  assert.ok(configFieldsForNode("agent").length > 0);
  assert.ok(configFieldsForNode("channel_send").length > 0);
});

test("canvas math computes cubic Bezier edges, ports, zoom/fit viewport, tidy layout, and cycle checks", () => {
  const detail = normalizeGraphDetail(fullServerGraph);
  const p1 = outputPortPos(detail.nodes[0]!);
  const p2 = inputPortPos(detail.nodes[1]!);
  const path = bezierEdgePath(p1.x, p1.y, p2.x, p2.y);
  assert.match(path, /^M \d+ \d+ C \d+ \d+, \d+ \d+, \d+ \d+$/);

  assert.equal(clampZoom(0.1), 0.4);
  assert.equal(clampZoom(5), 2.0);
  const fit = computeFitViewport(detail.nodes, 860, 380);
  assert.ok(fit.zoom >= 0.4 && fit.zoom <= 1.15);

  assert.equal(wouldCreateCycle(detail.nodes, detail.edges, "alert-1", "cron-1"), true);
  assert.equal(wouldCreateCycle(detail.nodes, detail.edges, "cron-1", "alert-1"), false);

  const tidied = tidyGraphNodes(detail.nodes, detail.edges);
  assert.ok(tidied[0]!.position.x < tidied[1]!.position.x);
  assert.ok(tidied[1]!.position.x < tidied[2]!.position.x);

  assert.equal(runStateStroke("completed", "var(--muted)"), "var(--ok)");
  assert.equal(runStateStroke("running", "var(--muted)"), "var(--accent)");
  assert.equal(runStateStroke("failed", "var(--muted)"), "var(--danger)");

  const preview = computeLayoutPreview(summaryFromDetail(detail));
  assert.equal(preview.nodes.length, 3);
  assert.equal(preview.edges.length, 2);

  const stub = normalizeGraphDetail(stubServerGraph);
  assert.equal(stub.nodes.length, 3);
  assert.equal(stub.edges.length, 2);
  assert.equal(synthesizeStudioGraph(summaryFromDetail(stub)).nodes.length, 3);
});

test("draft operations handle add, move, connect, cycle guard, edit, delete, tidy, and dirty tracking", () => {
  const saved = normalizeGraphDetail(fullServerGraph);
  let draft = draftFromDetail(saved);
  assert.equal(isDraftDirty(saved, draft), false);

  const added = addNodeToDraft(draft, WORKFLOW_PALETTE_ITEMS.find((i) => i.id === "flow-delay")!, "host-1");
  draft = added.draft;
  assert.equal(isDraftDirty(saved, draft), true);
  assert.equal(draft.nodes.length, 4);
  assert.equal(draft.edges.some((e) => e.source === "host-1" && e.target === added.node.id), true);

  draft = moveNodeInDraft(draft, added.node.id, 420.4, 210.7);
  assert.deepEqual(draft.nodes.find((n) => n.id === added.node.id)?.position, { x: 420, y: 211 });

  // Prevent connecting into trigger or creating cycles or self-loops
  assert.ok(connectEdgeInDraft(draft, "host-1", "cron-1").error);
  assert.ok(connectEdgeInDraft(draft, "host-1", "host-1").error);
  assert.ok(connectEdgeInDraft(draft, "alert-1", "host-1").error);

  const conn = connectEdgeInDraft(draft, added.node.id, "alert-1");
  assert.equal(conn.error, undefined);
  assert.ok(conn.edge);
  draft = conn.draft;

  draft = updateEdgeInDraft(draft, conn.edge!.id, { style: "dashed", disabled: true });
  assert.equal(draft.edges.find((e) => e.id === conn.edge!.id)?.style, "dashed");

  draft = updateNodeInDraft(draft, "cron-1", { config: { mode: "interval", everyMinutes: 30, cron: "bad", timezone: "UTC" } });
  const schedCfg = draft.nodes.find((n) => n.id === "cron-1")?.config;
  assert.equal(schedCfg?.mode, "interval");
  assert.equal("cron" in (schedCfg ?? {}), false);

  draft = tidyDraftLayout(draft);
  draft = removeEdgeFromDraft(draft, conn.edge!.id);
  draft = removeNodeFromDraft(draft, added.node.id);
  assert.equal(draft.nodes.length, 3);
});

test("studio API sends exact live /api/v1/workflows payloads for CRUD and run controls", async () => {
  const calls: StudioCall[] = [];
  const fetcher = createStudioFetcher(calls);

  const list = await readWorkflowGraphDetails(signal, fetcher);
  assert.equal(list.length, 1);
  const tplDraft = WORKFLOW_STARTER_TEMPLATES[1]!.build();
  const created = await createWorkflowGraphApi(tplDraft, signal, fetcher);
  assert.equal(created.id, "wf-prod-1");
  await updateWorkflowGraphApi(created.id, created.revision, draftFromDetail(created), signal, fetcher);
  await cloneWorkflowGraphApi(created.id, signal, fetcher);
  const run = await runWorkflowGraphApi(created.id, created.revision, {}, signal, fetcher);
  assert.equal(run.nodes.length, 1);
  assert.equal(runNodeStateMap(run, created.id)["cron-1"], "completed");
  await readWorkflowRunDetailApi(run.id, signal, fetcher);
  await stopWorkflowRunApi(run.id, signal, fetcher);
  await retryWorkflowRunApi(run.id, signal, fetcher);
  await deleteWorkflowRunApi(run.id, signal, fetcher);
  await deleteWorkflowGraphApi(created.id, created.revision, signal, fetcher);

  assert.deepEqual(calls.map((c) => c.body?.action ?? c.method), [
    "GET", "create", "update", "clone", "run", "GET", "run_stop", "run_retry", "run_delete", "delete",
  ]);
  const runCall = calls.find((c) => c.body?.action === "run");
  assert.equal(runCall?.body?.expected_revision, "a".repeat(64));

  await assert.rejects(
    deleteWorkflowGraphApi("wf-1", "r1", signal, async () => Response.json({ error: "secret stack" }, { status: 403 })),
    (err: unknown) => err instanceof ApiError && err.status === 403 && !err.message.includes("secret stack"),
  );
});

test("filtering, duration formatting, and hard repo gates hold across all workflow files", () => {
  const detail = normalizeGraphDetail(fullServerGraph);
  assert.equal(filterGraphDetails([detail], "cron", "active").length, 1);
  assert.equal(filterGraphDetails([detail], "cron", "draft").length, 0);
  assert.equal(formatDurationMs("2026-11-24T10:00:00.000Z", "2026-11-24T10:00:02.500Z"), "2.5 s");
  assert.equal(filterRunSummaries([failedRunSummary], "host", "failed").length, 1);

  const files = readdirSync(workflowDir).filter((f) => /\.(ts|svelte)$/.test(f));
  assert.ok(files.length >= 6);
  for (const name of files) {
    const src = readFileSync(new URL(name, workflowDir), "utf8");
    const lines = src.split("\n");
    const count = lines.length - (src.endsWith("\n") ? 1 : 0);
    assert.ok(count <= 250, `${name} has ${count} lines (> 250 limit)`);
    assert.equal(src.includes("\u2014"), false, `${name} contains em dash`);
    assert.equal(src.includes("{@html"), false, `${name} contains {@html}`);
    assert.equal(/\bwindow\.(confirm|alert|prompt)\s*\(/.test(src), false, `${name} uses window dialog`);
    assert.equal(/\b(localStorage|sessionStorage)\./.test(src), false, `${name} uses Web Storage`);
    const maxLen = Math.max(...lines.map((l) => l.length));
    assert.ok(maxLen <= 400, `${name} has a line of ${maxLen} chars (> 400 limit)`);
  }
});
