import { expect } from "@playwright/test";

async function call(page, body) {
  return page.evaluate(async (body) => {
    const response = await fetch("/api/v1/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, body);
}
async function get(page, query) {
  return page.evaluate(async (query) => { const response = await fetch(`/api/v1/workflows?${query}`); return { status: response.status, body: await response.json() }; }, query);
}

export async function workflowCanvasJourney(page, fixture) {
  let response = await call(page, {
    action: "create",
    graph: {
      name: "E2E Canvas Workflow", description: "Canvas/runtime integration fixture", status: "draft", inputs: {}, metadata: { provenance: "user" },
      nodes: [
        { id: "manual", name: "Manual Trigger", type: "manual", position: { x: 40, y: 260 }, config: {} },
        { id: "cache", name: "Cache Context", type: "cache", position: { x: 300, y: 260 }, config: { mode: "get_or_set", key: "e2e-canvas-cache", ttlSeconds: 60, value: { $ref: "input" } } },
        { id: "memory", name: "Memory Search", type: "memory", position: { x: 560, y: 260 }, config: { scope: "agent", mode: "search", query: "e2e-canvas", limit: 4 } },
        { id: "session", name: "Current Session", type: "session", position: { x: 820, y: 260 }, config: { mode: "current" } },
        { id: "directory", name: "Tool Directory", type: "directory", position: { x: 1080, y: 260 }, config: { source: "tools", query: "memory", limit: 20 } },
        { id: "condition", name: "Route OK", type: "condition", position: { x: 1340, y: 260 }, config: { path: "input.ok" } },
        { id: "yes", name: "Success Output", type: "output", position: { x: 1620, y: 160 }, config: { value: { ok: true } } },
        { id: "no", name: "Fallback Output", type: "output", position: { x: 1620, y: 380 }, config: { value: { ok: false } } },
      ],
      edges: [
        { id: "edge-manual-cache", source: "manual", target: "cache" },
        { id: "edge-cache-memory", source: "cache", target: "memory" },
        { id: "edge-memory-session", source: "memory", target: "session" },
        { id: "edge-session-directory", source: "session", target: "directory" },
        { id: "edge-directory-condition", source: "directory", target: "condition" },
        { id: "edge-true", source: "condition", target: "yes", sourceHandle: "true" },
        { id: "edge-false", source: "condition", target: "no", sourceHandle: "false" },
      ],
    },
  });
  expect(response.status).toBe(200);
  let graph = response.body.graph;

  await page.goto(fixture.base + "/workflows");
  await expect(page.getByRole("application", { name: "Workflow canvas" })).toBeVisible();
  for (const name of ["Select mode", "Pan mode", "Zoom in", "Zoom out", "Fit view"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tidy up" })).toBeVisible();
  const minimap = page.getByLabel("Workflow canvas minimap");
  await expect(minimap).toBeVisible();
  await expect(minimap.locator(".react-flow__minimap-node")).toHaveCount(8);
  await expect(page.locator(".react-flow__node", { hasText: "Manual Trigger" })).toBeVisible();

  // Responsive contract: on a phone-sized pane the wide graph starts focused on
  // the trigger at a readable zoom, side panels become drawers, and the toolbar
  // collapses secondary actions without horizontal feature overflow.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base + "/workflows");
    const feature = page.locator('[data-slot="workflows-feature"]');
    await expect(feature).toBeVisible();
    expect(await feature.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.getByLabel("Workflow name")).toBeVisible();
    const trigger = page.locator(".react-flow__node", { hasText: "Manual Trigger" });
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(viewport.width < 700 ? 140 : 95);
    if (viewport.width < 700) {
      await expect(page.getByRole("button", { name: "New workflow" })).toBeVisible();
      await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture.base + "/workflows");

  const normalPath = page.locator('[data-testid="rf__edge-edge-manual-cache"] .react-flow__edge-path');
  const branchPath = page.locator('[data-testid="rf__edge-edge-true"] .react-flow__edge-path');
  await expect(normalPath).toHaveAttribute("marker-end", /url/);
  await expect(branchPath).toHaveAttribute("marker-end", /url/);
  expect(await normalPath.evaluate((el) => getComputedStyle(el).strokeDasharray)).toBe("none");
  expect(await branchPath.evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe("none");

  await page.getByRole("button", { name: "Pan mode" }).click();
  await expect(page.getByRole("button", { name: "Pan mode" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Select mode" }).click();
  await expect(page.getByRole("button", { name: "Select mode" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Fit view" }).click();

  await page.getByRole("button", { name: "Directory", exact: true }).click();
  await expect(page.getByPlaceholder("Search tools…")).toBeVisible();
  await expect(page.getByText("agent_memory_search", { exact: true })).toBeVisible();

  const active = page.getByRole("switch", { name: "Active" });
  await expect(active).not.toBeChecked();
  await active.click();
  await expect(active).toBeChecked();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Unsaved", { exact: true })).toBeHidden();
  response = await get(page, `graph_id=${encodeURIComponent(graph.id)}`);
  expect(response.status).toBe(200); graph = response.body.graph;
  expect(graph.status).toBe("active");

  response = await call(page, { action: "run", graph_id: graph.id, input: { ok: true, payload: "cached-value" }, idempotency_key: `e2e-canvas-${Date.now()}` });
  expect(response.status).toBe(200);
  let run = response.body;
  for (let i = 0; i < 12 && run.state === "running"; i += 1) {
    const polled = await get(page, `run_id=${encodeURIComponent(run.id)}&wait_ms=1500`); expect(polled.status).toBe(200); run = polled.body;
  }
  expect(run.state).toBe("completed");
  for (const id of ["cache", "memory", "session", "directory", "condition", "yes"]) expect(run.nodes.find((node) => node.id === id)?.state).toBe("completed");
  expect(run.nodes.find((node) => node.id === "no")?.state).toBe("skipped");
  expect(run.edges.find((edge) => edge.id === "edge-true")?.state).toBe("enabled");
  expect(run.edges.find((edge) => edge.id === "edge-false")?.state).toBe("disabled");

  await page.getByRole("button", { name: "Tidy up" }).click();
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  // Delete using the last persisted revision; the local tidy is intentionally unsaved.
  response = await call(page, { action: "delete", graph_id: graph.id, expected_revision: graph.revision });
  expect(response.status).toBe(200);
  console.log("PASS Workflow responsive toolbar/drawers, readable compact trigger focus, 5/5 canvas controls, minimap, edge semantics, active mode, cache/memory/session/directory runtime and cleanup");
}
