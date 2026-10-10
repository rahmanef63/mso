import { expect } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function agentVaultJourney(page, fixture) {
  let connectionReads = 0;
  const countReads = request => { if (request.url().includes("/api/v1/memory-graph")) connectionReads++; };
  page.on("request", countReads);
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
  expect(connectionReads).toBe(0);
  await page.getByRole("button", { name: "Backlinks", exact: true }).click();
  const backlinks = page.getByRole("region", { name: "Note backlinks" });
  await expect(backlinks.getByRole("button", { name: "Agent progress", exact: true })).toBeVisible();
  expect(connectionReads).toBe(1);
  await backlinks.getByRole("button", { name: "Agent progress", exact: true }).click();
  const reader = page.getByRole("region", { name: "Note reader" });
  await reader.getByRole("button", { name: "Fixture worker", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixture worker", exact: true })).toBeVisible();
  expect(connectionReads).toBe(1);
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
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Recorded changes from repository captures.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  // Code uses the selected host adapter; exercise real read/write, then restore fixture mode.
  const prefsFile = path.join(fixture.dir, "prefs.json");
  const savedPrefs = await readFile(prefsFile, "utf8").catch(() => "{}");
  const prefs = JSON.parse(savedPrefs);
  await writeFile(prefsFile, JSON.stringify({ ...prefs, tweaks: { ...prefs.tweaks, server: { mode: "live", activeTargetId: "vps", url: "" } } }), { mode: 0o600 });
  await page.reload();
  await expect(page.getByLabel("Server connection mode")).toHaveAttribute("data-connection-mode", "live");
  await page.getByRole("button", { name: "Personal notes", exact: true }).click();
  await page.getByLabel("New note title", { exact: true }).fill("Fixture personal note");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const personalDirectory = path.join(state.root, "Notes");
  const personalFiles = async () => (await readdir(personalDirectory).catch(() => [])).filter(name => name.endsWith(".md"));
  await expect.poll(async () => (await personalFiles()).length).toBe(1);
  const personalFile = path.join(personalDirectory, (await personalFiles())[0]);
  await expect(page.locator("textarea").filter({ visible: true }).first()).toHaveValue("# Fixture personal note\n\n");
  await page.locator("textarea").filter({ visible: true }).first().fill("# Fixture personal note\n\nSaved in the native editor.\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => readFile(personalFile, "utf8")).toContain("Saved in the native editor.");
  await writeFile(prefsFile, savedPrefs, { mode: 0o600 });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(fixture.base + "/agent-vault");
    await expect(page.getByRole("button", { name: /^Fixture worker/ })).toBeVisible();
    await page.getByRole("button", { name: /^Fixture worker/ }).click();
    await expect(page.getByRole("heading", { name: "Fixture worker", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (viewport.width < 640) {
      await expect(page.getByRole("complementary", { name: "Vault navigation" })).toBeHidden();
      await page.getByRole("button", { name: "Back to notes", exact: true }).click();
      await expect(page.getByLabel("Search vault notes", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Note reader" })).toBeHidden();
    }
  }
  await fixture.setRole("viewer");
  const denied = await page.evaluate(async () => {
    const read = await fetch("/api/v1/agent-vault"), sync = await fetch("/api/v1/agent-vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return [read.status, sync.status];
  });
  expect(denied).toEqual([403, 403]);
  await fixture.setRole("owner");
  page.off("request", countReads);
  await page.setViewportSize({ width: 1280, height: 900 });
}
