import { expect } from "@playwright/test";

async function call(page, route, body) {
  return page.evaluate(async ([route, body]) => {
    const init = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {};
    const response = await fetch(route, init);
    return { status: response.status, body: await response.json() };
  }, [route, body]);
}

export async function organizationJourney(page, fixture) {
  let response = await call(page, "/api/v1/organization");
  expect(response.status).toBe(200);
  let revision = response.body.chart.revision;

  response = await call(page, "/api/v1/organization", {
    action: "unit_upsert", expected_revision: revision,
    unit: { id: "e2e-holding", key: "e2e-holding", name: "E2E Holding", kind: "holding", status: "active", sortOrder: 0 },
  });
  expect(response.status).toBe(200); revision = response.body.chart.revision;
  response = await call(page, "/api/v1/organization", {
    action: "unit_upsert", expected_revision: revision,
    unit: { id: "e2e-product", key: "e2e-product", name: "E2E Product", kind: "division", status: "active", parentUnitId: "e2e-holding", sortOrder: 1 },
  });
  expect(response.status).toBe(200); revision = response.body.chart.revision;
  response = await call(page, "/api/v1/organization", {
    action: "seat_upsert", expected_revision: revision,
    seat: { id: "e2e-ceo", unitId: "e2e-holding", name: "E2E CEO", title: "Chief Executive Officer", role: "ceo", state: "active", seatMode: "permanent", target: { kind: "none" }, responsibilities: ["Direction"] },
  });
  expect(response.status).toBe(200); revision = response.body.chart.revision;
  response = await call(page, "/api/v1/organization", {
    action: "seat_upsert", expected_revision: revision,
    seat: { id: "e2e-cto", unitId: "e2e-product", name: "E2E CTO", title: "Chief Technology Officer", role: "cto", state: "active", seatMode: "on_demand", reportsToSeatId: "e2e-ceo", target: { kind: "none" }, responsibilities: ["Technology"] },
  });
  expect(response.status).toBe(200);

  await page.goto(fixture.base + "/organization");
  const unitDirectory = page.locator('[data-slot="organization-unit-directory"]');
  await expect(unitDirectory).toBeVisible();
  await expect(unitDirectory.getByRole("button", { name: /E2E Holding/ })).toBeVisible();
  await expect(unitDirectory.getByRole("button", { name: /E2E Product/ })).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const unitCanvas = page.getByRole("application", { name: "Organization units canvas" });
  await expect(unitCanvas).toBeVisible();
  for (const name of ["Select mode", "Pan mode", "Zoom in", "Zoom out", "Fit view"]) await expect(unitCanvas.getByRole("button", { name })).toBeVisible();
  const unitMinimap = unitCanvas.getByLabel("Organization units canvas minimap");
  await expect(unitMinimap).toBeVisible();
  await expect(unitMinimap.locator(".react-flow__minimap-node")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  // Responsive contract: compact panes use one native unit picker, hide desktop-only
  // shortcut copy, keep the graph readable, and never grow wider than the feature pane.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base + "/organization");
    const feature = page.locator('[data-slot="organization-feature"]');
    await expect(feature).toBeVisible();
    expect(await feature.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (viewport.width < 700) {
      await expect(page.getByLabel("Organization unit", { exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Organization units" })).toBeHidden();
    } else {
      await expect(page.getByRole("navigation", { name: "Organization units" })).toBeVisible();
    }
    await expect(page.locator('[data-slot="organization-unit-directory"]')).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture.base + "/organization");

  await page.locator('[data-slot="organization-unit-directory"]').getByRole("button", { name: /E2E Product/ }).click();
  await page.getByRole("button", { name: "Seats", exact: true }).click();
  await expect(page.locator('[data-slot="organization-seat-directory"]')).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const seatCanvas = page.getByRole("application", { name: "Organization seats canvas" });
  await expect(seatCanvas).toBeVisible();
  await expect(seatCanvas.locator(".react-flow__node", { hasText: "Chief Executive Officer" })).toBeVisible();
  const seatMinimap = seatCanvas.getByLabel("Organization seats canvas minimap");
  await expect(seatMinimap.locator(".react-flow__minimap-node")).toHaveCount(2);
  const reportingEdge = seatCanvas.getByRole("img", { name: "Edge from e2e-ceo to e2e-cto" }).locator(".react-flow__edge-path");
  await expect(reportingEdge).toHaveAttribute("marker-end", /url/);
  expect(await reportingEdge.evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe("none");
  const cto = seatCanvas.locator(".react-flow__node", { hasText: "Chief Technology Officer" });
  await expect(cto).toBeVisible();
  await cto.click();
  await expect(page.getByRole("button", { name: "Edit seat" })).toBeVisible();
  await page.getByRole("button", { name: "Edit seat" }).click();
  await expect(page.getByRole("heading", { name: "Edit seat" })).toBeVisible();
  await page.getByLabel("Execution target").selectOption("project-agent");
  await page.getByRole("textbox", { name: "Project", exact: true }).fill("fixture-project");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit seat" })).toBeHidden();

  response = await call(page, "/api/v1/organization");
  expect(response.status).toBe(200); revision = response.body.chart.revision;
  expect(response.body.chart.seats.find(seat => seat.id === "e2e-cto")?.target).toEqual({ kind: "project-agent", project: "fixture-project" });
  for (const [action, id] of [["seat_delete", "e2e-cto"], ["seat_delete", "e2e-ceo"], ["unit_delete", "e2e-product"], ["unit_delete", "e2e-holding"]]) {
    response = await call(page, "/api/v1/organization", { action, expected_revision: revision, id });
    expect(response.status).toBe(200); revision = response.body.chart.revision;
  }
  expect((await call(page, "/api/v1/organization")).body.chart.units).toHaveLength(0);
  console.log("PASS Organization responsive picker/sidebar reflow, readable compact graph, 5/5 controls, populated minimap, directional reporting edge, seat edit/routing and cleanup");
}
