#!/usr/bin/env node
// Real UI/API/MCP journey with disposable stores; never borrows deployment credentials.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { releaseFixture } from "./release-fixture.mjs";

const fixture = await releaseFixture({ live: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(device => { localStorage.setItem("mso.device.id", device); localStorage.setItem("mso:onboarding:v1", "done"); }, fixture.device);
  const login = await fetch(fixture.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: fixture.base }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device, deviceLabel: "Organization flow fixture" }) });
  expect(login.ok).toBe(true);
  const cookie = /(?:^|,\s*)session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("Fixture session missing");
  await context.addCookies([{ name: "session", value: cookie, url: fixture.base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture.base + "/organization");
  const call = async (body) => page.evaluate(async (body) => {
    const response = await fetch("/api/v1/organization", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: response.status, body: await response.json() };
  }, body);
  let chart = (await call()).body.chart;
  for (const id of ["flow-workspace", "other-workspace"]) {
    const result = await call({ action: "unit_upsert", expected_revision: chart.revision, unit: { id, key: id, name: id === "flow-workspace" ? "Flow Workspace" : "Other Workspace", description: "A compact organization summary. ".repeat(20), kind: "company" } });
    expect(result.status).toBe(200); chart = result.body.chart;
  }
  const open = async () => {
    await page.goto(fixture.base + "/organization");
    const directory = page.locator('[data-slot="organization-unit-directory"]');
    await expect(directory).toBeVisible();
    const card = directory.getByRole("button", { name: /Flow Workspace/ });
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.offsetHeight)).toBeLessThan(220);
    await card.click();
    await expect(page.locator('[data-slot="organization-project-flow"]')).toBeVisible();
  };
  await open();
  await page.getByRole("button", { name: "Add first node", exact: true }).click();
  await page.getByLabel("Node title", { exact: true }).fill("First Project");
  await page.getByLabel("Summary", { exact: true }).fill("Evidence stays inside this node.");
  await page.getByLabel("Notes", { exact: true }).fill("Not an employment or revenue commitment.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New node", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Node", exact: true }).click();
  await page.getByLabel("Node title", { exact: true }).fill("Second Project");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New node", exact: true })).toBeHidden();
  chart = (await call()).body.chart;
  const flow = () => chart.units.find((unit) => unit.id === "flow-workspace").projectFlow;
  const first = flow().nodes[0].id, second = flow().nodes[1].id;
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("From node").selectOption(first);
  await page.getByLabel("To node").selectOption(second);
  await page.getByLabel("Relationship", { exact: true }).fill("supports");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New edge", exact: true })).toBeHidden();
  const canvas = page.getByRole("application", { name: "Organization project flow canvas", exact: true });
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
  await expect(canvas.locator(".react-flow__edge-path")).toHaveAttribute("marker-end", /url/);
  await canvas.locator(`[data-id="${first}"]`).click();
  await page.getByRole("button", { name: "Edit node", exact: true }).click();
  await page.getByLabel("Node title", { exact: true }).fill("First Project revised");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit node", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Close node details", exact: true }).click();
  const before = (await call()).body.chart.units.find((u) => u.id === "flow-workspace").projectFlow.nodes[0].position;
  const card = canvas.locator(`[data-id="${first}"]`);
  await expect(card).toBeVisible();
  await page.waitForTimeout(400);
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 25);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + 85, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await call()).body.chart.units.find((u) => u.id === "flow-workspace").projectFlow.nodes[0].position)).not.toBe(JSON.stringify(before));
  const notes = "# Source notes\n" + "Unconfirmed source statement.\n".repeat(800);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Flow title", { exact: true }).fill("Project Delivery");
  await page.getByLabel("Notes", { exact: true }).fill(notes);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flow notes", exact: true })).toBeHidden();
  await open();
  await expect(canvas.locator(`[data-id="${first}"]`)).toContainText("First Project revised");
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
  chart = (await call()).body.chart;
  expect(flow().notes).toBe(notes); expect(flow().edges).toHaveLength(1);
  expect(chart.units.find((u) => u.id === "other-workspace").projectFlow).toBeUndefined();

  await fixture.seedMcp("write");
  const mcp = async (name, args) => {
    const response = await fetch(fixture.base + "/mcp", { method: "POST", headers: { authorization: `Bearer ${fixture.mcpToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { "mso/conversationKey": "organization-flow-fixture" } } }) });
    const text = await response.text();
    return JSON.parse(text.startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data: ")).at(-1).slice(6));
  };
  const stale = chart.revision;
  const viaMcp = await mcp("organization_manage", { action: "flow_node_upsert", expected_revision: chart.revision, data: { unitId: "flow-workspace", node: { id: first, notes: "Updated via real MCP function calling" } } });
  expect(viaMcp.error).toBeUndefined(); expect(viaMcp.result?.isError).not.toBe(true);
  chart = (await call()).body.chart;
  expect(flow().nodes[0].notes).toBe("Updated via real MCP function calling");
  expect((await call({ action: "flow_update", expected_revision: stale, data: { unitId: "flow-workspace", notes: "must not overwrite" } })).status).toBe(409);
  expect((await call({ action: "flow_edge_upsert", expected_revision: chart.revision, data: { unitId: "other-workspace", edge: { source: first, target: second } } })).status).toBe(400);
  await fixture.setRole("viewer");
  expect((await call({ action: "flow_update", expected_revision: chart.revision, data: { unitId: "flow-workspace", notes: "denied" } })).status).toBe(403);
  await fixture.setRole("owner");
  await fixture.seedMcp("read");
  const denied = await mcp("organization_manage", { action: "flow_update", expected_revision: chart.revision, data: { unitId: "flow-workspace", notes: "denied" } });
  expect(Boolean(denied.error || denied.result?.isError)).toBe(true);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await open();
    const feature = page.locator('[data-slot="organization-feature"]');
    expect(await feature.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(canvas.locator(`[data-id="${first}"]`)).toBeVisible();
    await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
    if (process.env.MSO_SCREENSHOT_DIR) { await mkdir(process.env.MSO_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.MSO_SCREENSHOT_DIR, `organization-flow-${viewport.width}.png`) }); }
  }
  chart = (await call()).body.chart;
  const deleted = await call({ action: "flow_node_delete", expected_revision: chart.revision, data: { unitId: "flow-workspace", id: first } });
  expect(deleted.status).toBe(200);
  expect(deleted.body.chart.units.find((u) => u.id === "flow-workspace").projectFlow.edges).toEqual([]);
  expect(errors).toEqual([]);
  console.log("PASS: compact overview; internal node create/edit/connect/drag; visible directional edges after reload; multiline notes >16 KiB; reload persistence; real MCP mutation; stale revision/cross-unit/viewer/read-scope refusal; 3 responsive viewports; cascade delete; no browser errors.");
} finally { await browser?.close(); await fixture.close(); }
