// Actual Settings UI; backup transport is intercepted so no host memory is read or copied.
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const id = "11111111-1111-4111-8111-111111111111", revision = "a".repeat(64);
const snapshot = { id, state: "partial", createdAt: "2026-01-01T00:00:00.000Z", directory: "/synthetic/backups/" + id,
  manifestSha256: "b".repeat(64), scan: { files: 2, bytes: 10, missing: 1, rejected: 0, excluded: 1, truncated: true },
  compressedBytes: 30, sourceDiscoveryTruncated: false, consistency: "per-file-verified-not-point-in-time", offsite: false };
export async function memoryBackupHistoryJourney(page, fixture) {
  const pattern = "**/api/v1/sys/memory-backup**", checks = [], screenshots = [], errors = [];
  const onError = error => errors.push(error.message); page.on("pageerror", onError);
  let fail = false, posts = [], queries = [];
  await page.route(pattern, async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === "POST") {
      const body = req.postDataJSON(); posts.push(body);
      if (body.action !== "verify" || body.confirm !== true || body.id !== id || body.manifest_sha256 !== snapshot.manifestSha256)
        return route.fulfill({ status: 400, json: { error: "Unexpected synthetic mutation" } });
      return route.fulfill({ json: { id, integrity: true, complete: false, restoredFiles: 2, sourceWritesPerformed: 0, restoreDirectory: "/synthetic/restore" } });
    }
    queries.push(Object.fromEntries(url.searchParams));
    if (fail) return route.fulfill({ status: 503, json: { error: "Snapshot history unavailable — retry" } });
    if (url.searchParams.get("view") !== "history") return route.fulfill({ status: 400, json: { error: "No source scans in this UI fixture" } });
    const more = url.searchParams.has("offset");
    return route.fulfill({ json: { items: more
      ? [{ id: "22222222-2222-4222-8222-222222222222", status: "unreadable", error: "snapshot-unreadable" }]
      : [{ id, status: "readable", snapshot, integrity: "not-recorded" }], nextOffset: more ? null : 12, revision, order: "directory", scannedEntries: 12 } });
  });
  const out = process.env.MSO_SCREENSHOT_DIR;
  try {
    for (const viewport of [{ width: 1363, height: 936 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); posts = []; queries = []; fail = false;
      await page.goto(fixture.base + "/settings?section=backup");
      await expect(page.getByText("Server memory backup", { exact: true })).toBeVisible();
      await expect(page.getByText("Browser backup", { exact: true })).toBeVisible();
      expect(queries).toHaveLength(0); expect(posts).toHaveLength(0);
      await page.getByRole("button", { name: "Load saved server snapshots", exact: true }).click();
      await expect(page.getByText(/Partial snapshot · 2 files · No saved integrity receipt/)).toBeVisible();
      await page.getByRole("button", { name: "Load more saved snapshots", exact: true }).click();
      await expect(page.getByText(/Snapshot metadata unreadable — not an empty backup/)).toBeVisible();
      expect(queries.some(q => q.offset === "12" && q.revision === revision)).toBe(true);
      await page.getByRole("button", { name: `${snapshot.createdAt} · ${id.slice(0, 8)}`, exact: true }).click();
      expect(posts).toHaveLength(0);
      await page.getByRole("button", { name: "Verify checksum and rehearse restore", exact: true }).click();
      await expect(page.getByText("2 files verified · partial snapshot only · source writes: 0", { exact: true })).toBeVisible();
      expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ action: "verify", confirm: true, id });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const accessibility = await new AxeBuilder({ page }).include('section:has([data-slot="settings-section-title"])').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(accessibility.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
        checks.push(`backup history/reflow/accessibility ${viewport.width}x${viewport.height} ${theme}`);
        if (out) {
          await mkdir(out, { recursive: true, mode: 0o700 });
          const file = path.join(out, `memory-backup-history-${viewport.width}-${theme}.png`);
          await page.getByText("Server memory backup", { exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: file }); screenshots.push(file);
        }
      }
      fail = true; await page.getByRole("button", { name: "Refresh saved server snapshots", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Snapshot history unavailable" })).toBeVisible();
      await expect(page.getByText("No saved snapshots", { exact: true })).toHaveCount(0);
      fail = false; await page.getByRole("button", { name: "Refresh saved server snapshots", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Snapshot history unavailable" })).toHaveCount(0);
      checks.push(`pagination, explicit restore and error/retry ${viewport.width}`);
    }
    await page.unroute(pattern);
    for (const role of ["operator", "viewer"]) {
      await fixture.setRole(role);
      const status = await page.evaluate(async () => (await fetch("/api/v1/sys/memory-backup?view=history")).status);
      expect(status).toBe(403); checks.push(`real API refuses ${role} before private backup access`);
    }
    expect(errors).toEqual([]);
  } finally {
    await fixture.setRole("owner"); await page.unroute(pattern); page.off("pageerror", onError);
    if (out) await writeFile(path.join(out, "memory-backup-history-receipt.json"), JSON.stringify({ at: new Date().toISOString(), environment: "isolated built Settings UI; synthetic backup transport; real role denials", checks, errors, screenshots }, null, 2), { mode: 0o600 });
  }
  console.log(`PASS memory backup history: ${checks.length} viewport/accessibility/pagination/role checks; no host snapshots accessed`);
}
