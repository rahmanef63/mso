import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function agentVaultJourney(page, fixture) {
  await page.goto(fixture.base + "/agent-vault");
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue(fixture.vaultProject);
  await page.getByRole("button", { name: "Refresh snapshot", exact: true }).click();
  await expect(page.getByLabel("Snapshot", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Fixture worker/ }).click();
  await expect(page.getByRole("heading", { name: "Fixture worker", exact: true })).toBeVisible();
  await expect(page.getByText("Responsible for verifying fixture tasks.", { exact: true })).toBeVisible();
  const state = await page.evaluate(async () => (await (await fetch("/api/v1/agent-vault")).json()).state);
  expect(state.root.startsWith(path.join(fixture.dir, "vault-data"))).toBe(true);
  expect(state.root.startsWith(fixture.vaultProject + path.sep)).toBe(false);
  const previous = state.current;
  await writeFile(path.join(fixture.vaultProject, "wiki/log.md"), "# Fixture progress\n\nSecond verified repository update.\n", { mode: 0o600 });
  await page.getByRole("button", { name: "Refresh snapshot", exact: true }).click();
  await expect(page.getByLabel("Snapshot", { exact: true }).locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: /^Fixture progress/ }).click();
  await expect(page.getByText("Second verified repository update.", { exact: true })).toBeVisible();
  await page.getByLabel("Snapshot", { exact: true }).selectOption(previous);
  await page.getByRole("button", { name: /^Fixture progress/ }).click();
  await expect(page.getByText("First verified repository update.", { exact: true })).toBeVisible();
  expect(await readFile(path.join(fixture.vaultProject, "wiki/log.md"), "utf8")).toContain("Second verified");
  await page.getByLabel("Search vault notes", { exact: true }).fill("worker");
  await expect(page.getByRole("button", { name: /^Fixture worker/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fixture progress/ })).toHaveCount(0);
  await page.getByLabel("Search vault notes", { exact: true }).fill("");
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base + "/agent-vault");
    await expect(page.getByRole("button", { name: /^Fixture worker/ })).toBeVisible();
    await page.getByRole("button", { name: /^Fixture worker/ }).click();
    await expect(page.getByRole("heading", { name: "Fixture worker", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await fixture.setRole("viewer");
  const denied = await page.evaluate(async () => {
    const read = await fetch("/api/v1/agent-vault"), sync = await fetch("/api/v1/agent-vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return [read.status, sync.status];
  });
  expect(denied).toEqual([403, 403]);
  await fixture.setRole("owner");
  await page.setViewportSize({ width: 1280, height: 900 });
}
