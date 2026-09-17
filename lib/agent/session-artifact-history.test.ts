import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureSessionArtifactRevision, resolveArtifactRevisionView } from "./session-artifact-history";

const roots: string[] = [];
afterEach(async () => {
  delete process.env.OS_FS_WRITE_ROOTS;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mso-artifact-history-"));
  roots.push(root); process.env.OS_FS_WRITE_ROOTS = root;
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com"); git(root, "config", "user.name", "MSO Test");
  await writeFile(path.join(root, "app.ts"), "export const value = 1;\n", "utf8");
  git(root, "add", "app.ts"); git(root, "commit", "-m", "initial");
  return root;
}

describe("session artifact revision proof", () => {
  it("resolves an exact committed snapshot and a current diff without storing source in the revision metadata", async () => {
    const root = await fixture();
    const revision = await captureSessionArtifactRevision({ kind: "tool", tool: "fs_write", detail: "app.ts" }, root);
    expect(revision).toMatchObject({ version: 1, relativePath: "app.ts", cleanAtCapture: true });
    expect(JSON.stringify(revision)).not.toContain("export const value");
    await writeFile(path.join(root, "app.ts"), "export const value = 2;\n", "utf8");
    const view = await resolveArtifactRevisionView(revision);
    expect(view.capture.exactAtCapture).toBe(true);
    expect(view.historical).toMatchObject({ available: true, exact: true, source: "git-blob", previewRedacted: true });
    if (view.historical.available && "content" in view.historical) expect(view.historical.content).toContain("value = 1");
    expect(view.current).toMatchObject({ available: true, matchesCapture: false });
    expect(view.diff).toMatchObject({ available: true, changed: true, previewRedacted: true });
    if (view.diff.available) {
      expect(view.diff.unifiedDiff).toContain("-export const value = 1;");
      expect(view.diff.unifiedDiff).toContain("+export const value = 2;");
      expect(view.diff.unifiedDiff).not.toContain(root);
    }
  });

  it("fails safe for an uncommitted captured revision after the working file changes", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "app.ts"), "export const value = 2;\n", "utf8");
    const revision = await captureSessionArtifactRevision({ kind: "tool", tool: "fs_write", detail: "app.ts" }, root);
    expect(revision?.cleanAtCapture).toBe(false);
    await writeFile(path.join(root, "app.ts"), "export const value = 3;\n", "utf8");
    const view = await resolveArtifactRevisionView(revision);
    expect(view.historical).toMatchObject({ available: false, reason: "exact_snapshot_unavailable" });
    expect(view.diff).toMatchObject({ available: false, reason: "exact_snapshot_unavailable" });
  });

  it("can prove a dirty capture exactly while the file still matches its captured hash", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "app.ts"), "export const value = 9;\n", "utf8");
    const revision = await captureSessionArtifactRevision({ kind: "tool", tool: "fs_write", detail: "app.ts" }, root);
    const view = await resolveArtifactRevisionView(revision);
    expect(view.historical).toMatchObject({ available: true, exact: true, source: "current-match" });
    expect(view.diff).toMatchObject({ available: true, changed: false });
  });

  it("keeps read-only/legacy events metadata-free rather than pretending a snapshot exists", async () => {
    const root = await fixture();
    expect(await captureSessionArtifactRevision({ kind: "tool", tool: "fs_read", detail: "app.ts" }, root)).toBeUndefined();
    expect(await resolveArtifactRevisionView(undefined)).toMatchObject({ capture: { state: "legacy" }, historical: { available: false, reason: "no_capture_proof" } });
  });
});
