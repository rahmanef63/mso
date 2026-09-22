#!/usr/bin/env node
// Selection, persisted grouping and routed edges against a real build with private synthetic stores.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { releaseFixture } from "./release-fixture.mjs";
const fixture = await releaseFixture({ live: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript((device) => { localStorage.setItem("mso.device.id", device); localStorage.setItem("mso:onboarding:v1", "done"); }, fixture.device);
  const response = await fetch(fixture.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: fixture.base }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device }) });
  expect(response.ok).toBe(true);
  const cookie = /(?:^|,\s*)session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("Synthetic session missing");
  await context.addCookies([{ name: "session", value: cookie, url: fixture.base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture.base + "/organization");
  const api = (route, body) => page.evaluate(async ([route, body]) => { const r = await fetch(route, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); return { status: r.status, body: await r.json() }; }, [route, body]);
  let chart = (await api("/api/v1/organization")).body.chart;
  const orgNodes = ["a", "b", "c"].map((id, i) => ({ id, title: `Project ${id.toUpperCase()}`, kind: "project", status: "unconfirmed", summary: "Synthetic context", notes: "Preserve source notes", position: { x: i * 330, y: i === 1 ? 210 : 0 } }));
  const orgEdges = [{ id: "a-b", source: "a", target: "b", label: "supports" }, { id: "b-c", source: "b", target: "c", label: "continues" }];
  const created = await api("/api/v1/organization", { action: "unit_upsert", expected_revision: chart.revision, unit: { id: "custom-test", key: "custom-test", name: "Custom Test", kind: "team", projectFlow: { version: 1, title: "Context", notes: "Source", nodes: orgNodes, edges: orgEdges } } });
  expect(created.status).toBe(200);
  const openOrg = async () => { await page.goto(fixture.base + "/organization"); const directory = page.locator('[data-slot="organization-unit-directory"]'); await expect(directory).toBeVisible(); await directory.getByRole("button", { name: /Custom Test/ }).click(); await expect(page.locator('[data-slot="organization-project-flow"]')).toBeVisible(); };
  await openOrg();
  const orgCanvas = page.getByRole("application", { name: "Organization project flow canvas", exact: true });
  const select = async (canvas, ids) => { for (const id of ids) await canvas.locator(`[data-id="${id}"]`).click({ modifiers: ["Control"] }); await expect(page.locator('[data-slot="graph-custom-controls"]')).toContainText(`${ids.length} selected`); };
  const createGroup = async (name) => { await page.getByRole("button", { name: "Create custom node", exact: true }).click(); await page.getByLabel("Custom node name").fill(name); await page.getByRole("button", { name: "Create", exact: true }).click(); await expect(page.getByRole("heading", { name: "Create custom node", exact: true })).toBeHidden(); };
  await select(orgCanvas, ["a", "b"]); await createGroup("Delivery custom");
  await expect(orgCanvas.locator(".react-flow__node-customGroup")).toHaveCount(1);
  chart = (await api("/api/v1/organization")).body.chart;
  let saved = chart.units.find((u) => u.id === "custom-test").projectFlow;
  expect(saved.nodes).toEqual(orgNodes); expect(saved.edges).toEqual(orgEdges); expect(saved.customNodes[0].nodeIds.sort()).toEqual(["a", "b"]);
  await openOrg(); await expect(orgCanvas.locator(".react-flow__node-customGroup")).toHaveCount(1);
  await expect(orgCanvas.locator(".react-flow__edge")).toHaveCount(1);
  const customCard = orgCanvas.locator(".react-flow__node-customGroup");
  await page.waitForTimeout(350);
  const box = await customCard.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 24); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + 65, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await api("/api/v1/organization")).body.chart.units.find((u) => u.id === "custom-test").projectFlow.nodes[0].position.x).not.toBe(0);
  const moved = (await api("/api/v1/organization")).body.chart.units.find((u) => u.id === "custom-test").projectFlow;
  expect(moved.nodes[1].position.x - moved.nodes[0].position.x).toBe(330);
  expect(moved.nodes[1].position.y - moved.nodes[0].position.y).toBe(210);
  expect(moved.nodes[2]).toEqual(orgNodes[2]);
  await orgCanvas.locator(".react-flow__node-customGroup").dblclick();
  await expect(orgCanvas.locator(".react-flow__node-project")).toHaveCount(3);
  await page.getByLabel("Custom node", { exact: true }).selectOption(saved.customNodes[0].id);
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await expect.poll(async () => (await api("/api/v1/organization")).body.chart.units.find((u) => u.id === "custom-test").projectFlow.customNodes).toEqual([]);
  await openOrg(); await select(orgCanvas, ["a"]); await createGroup("Single custom");
  await expect(orgCanvas.locator(".react-flow__node-customGroup")).toHaveCount(1);
  await orgCanvas.locator(".react-flow__node-customGroup").dblclick();
  await expect(orgCanvas.locator(".react-flow__node-project")).toHaveCount(3);
  await expect(orgCanvas.locator('[data-routing-state="clear"]')).toHaveCount(2);
  const workflowNodes = [
    { id: "start", name: "Manual", type: "manual", position: { x: 0, y: 100 }, config: {} },
    { id: "a", name: "First step", type: "batch", position: { x: 330, y: 100 }, config: { items: [1, 2, 3], size: 2 } },
    { id: "b", name: "Second step", type: "batch", position: { x: 660, y: 100 }, config: { items: [4, 5], size: 1 } },
    { id: "out", name: "Output", type: "output", position: { x: 990, y: 100 }, config: {} },
  ];
  const workflowEdges = workflowNodes.slice(1).map((n, i) => ({ id: `e${i}`, source: workflowNodes[i].id, target: n.id }));
  const result = await api("/api/v1/workflows", { action: "create", graph: { name: "Custom Workflow", description: "Fixture", status: "draft", inputs: {}, metadata: {}, nodes: workflowNodes, edges: workflowEdges } });
  expect(result.status).toBe(200); const graphId = result.body.graph.id;
  await page.goto(fixture.base + "/workflows");
  const wfCanvas = page.getByRole("application", { name: "Workflow canvas", exact: true });
  await expect(wfCanvas).toBeVisible(); await wfCanvas.getByRole("button", { name: "Fit view", exact: true }).click();
  await select(wfCanvas, ["a", "b"]); await createGroup("Two-step custom");
  await expect(wfCanvas.locator(".react-flow__node-customGroup")).toHaveCount(1);
  const save = page.getByRole("button", { name: "Save", exact: true });
  if (await save.isVisible()) await save.click(); else { await page.getByRole("button", { name: "More actions", exact: true }).click(); await page.getByRole("menuitem", { name: "Save", exact: true }).click(); }
  await expect.poll(async () => (await api(`/api/v1/workflows?graph_id=${graphId}`)).body.graph.metadata.customNodes?.length).toBe(1);
  const graph = (await api(`/api/v1/workflows?graph_id=${graphId}`)).body.graph;
  expect(graph.nodes).toEqual(workflowNodes); expect(graph.edges).toEqual(workflowEdges);
  await page.reload(); await expect(wfCanvas.locator(".react-flow__node-customGroup")).toHaveCount(1);
  await expect(wfCanvas.locator(".react-flow__edge")).toHaveCount(2);
  await expect(wfCanvas.locator('[data-routing-state="clear"]')).toHaveCount(2);
  const run = await api("/api/v1/workflows", { action: "run", graph_id: graphId, input: {}, idempotency_key: "custom-execution-fixture" });
  expect(run.status).toBe(200);
  await expect.poll(async () => (await api(`/api/v1/workflows?run_id=${run.body.id}&wait_ms=500`)).body.state, { timeout: 20000 }).toBe("completed");
  const receipt = (await api(`/api/v1/workflows?run_id=${run.body.id}`)).body;
  expect(receipt.nodes.map((n) => n.id)).toEqual(workflowNodes.map((n) => n.id));
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.reload();
    await expect(wfCanvas.locator(".react-flow__node-customGroup")).toBeVisible();
    const overflow = await page.locator('[data-slot="workflows-feature"]').evaluate((el) => {
      const root = el.getBoundingClientRect();
      const offenders = [...el.querySelectorAll('*')].map((node) => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.right > root.right + 1 || rect.left < root.left - 1).slice(0, 12).map(({ node, rect }) => ({ tag: node.tagName, slot: node.getAttribute('data-slot'), cls: node.className?.toString?.().slice(0, 160), text: node.textContent?.trim().slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }));
      return { ok: el.scrollWidth <= el.clientWidth + 1, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, offenders };
    });
    expect(overflow, JSON.stringify(overflow, null, 2)).toMatchObject({ ok: true });
    if (process.env.MSO_SCREENSHOT_DIR) { await mkdir(process.env.MSO_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.MSO_SCREENSHOT_DIR, `custom-workflow-${viewport.width}.png`) }); }
  }
  expect(errors).toEqual([]);
  console.log("PASS: one/multi selection, custom node create/expand/ungroup/reload in organization; workflow grouping preserves branch ports/topology and executes original steps; directional obstacle-aware edges; desktop/mobile reflow.");
} finally { await browser?.close(); await fixture.close(); }
