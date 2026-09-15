import { expect } from "@playwright/test";

async function call(page, body) {
  return page.evaluate(async (body) => {
    const response = await fetch("/api/v1/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, body);
}

export async function workflowCanvasJourney(page, fixture) {
  let response = await call(page, {
    action: "create",
    graph: {
      name: "E2E Canvas Workflow", description: "Canvas navigation fixture", status: "draft", inputs: {}, metadata: { provenance: "user" },
      nodes: [
        { id: "manual", name: "Manual Trigger", type: "manual", position: { x: 620, y: 420 }, config: {} },
        { id: "action", name: "Fixture Action", type: "wait", position: { x: 120, y: 720 }, config: { delayMs: 0 } },
        { id: "output", name: "Output", type: "output", position: { x: 880, y: 80 }, config: {} },
      ],
      edges: [{ id: "edge-a", source: "manual", target: "action" }, { id: "edge-b", source: "action", target: "output" }],
    },
  });
  expect(response.status).toBe(200);
  const graph = response.body.graph;

  await page.goto(fixture.base + "/workflows");
  await expect(page.getByRole("application", { name: "Workflow canvas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pan mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tidy up" })).toBeVisible();
  await expect(page.getByLabel("Workflow canvas minimap")).toBeVisible();
  await expect(page.locator(".react-flow__node", { hasText: "Manual Trigger" })).toBeVisible();

  await page.locator(".react-flow__node", { hasText: "Fixture Action" }).click();
  await expect(page.getByText("Delay ms", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pan mode" }).click();
  await expect(page.getByRole("button", { name: "Pan mode" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Select mode" }).click();
  await expect(page.getByRole("button", { name: "Select mode" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Tidy up" }).click();
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  response = await call(page, { action: "delete", graph_id: graph.id, expected_revision: graph.revision });
  expect(response.status).toBe(200);
  console.log("PASS Workflow n8n-style canvas controls, selection/inspector, tidy-up and cleanup");
}
