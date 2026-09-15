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
  await expect(page.getByRole("application", { name: "Organization units canvas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pan mode" })).toBeVisible();
  await expect(page.getByLabel("Organization units canvas minimap")).toBeVisible();
  await expect(page.getByText("E2E Holding", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E Product", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.getByRole("button", { name: /E2E Product/ }).click();
  await expect(page.getByRole("application", { name: "Organization seats canvas" })).toBeVisible();
  await expect(page.locator(".react-flow__node", { hasText: "Chief Executive Officer" })).toBeVisible();
  const cto = page.locator(".react-flow__node", { hasText: "Chief Technology Officer" });
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
  console.log("PASS Organization hierarchy, cross-unit reporting, responsive chart, seat edit/routing and cleanup");
}
