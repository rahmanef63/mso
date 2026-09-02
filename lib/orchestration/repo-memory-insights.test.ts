import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportRepoMemoryBundle, importRepoMemoryBundle } from "./memory-sync";
import { relatedRepoMemory, repoMemoryTimeline } from "./repo-memory-insights";
import { upsertRepoMemory } from "./repo-memory";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-memory-insights-"));
const project = path.join(root, "source");
const target = path.join(root, "target");
await fs.mkdir(project);
await fs.mkdir(target);

afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("repo memory insights and portable sync", () => {
  it("derives explicit and conflict relations without an embedding/model call", async () => {
    const automated = await upsertRepoMemory(project, {
      kind: "test", title: "Reconnect smoke", summary: "Reconnect works", source: "automation", result: "pass",
      status: "confirmed", scope: ["runtime/reconnect"], tags: ["reconnect"], confidence: 0.9,
    });
    const manual = await upsertRepoMemory(project, {
      kind: "test", title: "Reconnect manual regression", summary: "Still freezes after reconnect", source: "user-manual", result: "fail",
      status: "active", scope: ["runtime/reconnect"], tags: ["reconnect"], confidence: 1,
    });
    const fixed = await upsertRepoMemory(project, {
      kind: "debug", title: "Reconnect fix", summary: "Replaced stale receiver state", source: "agent", result: "pass",
      status: "confirmed", scope: ["runtime/reconnect"], tags: ["reconnect"], supersedes: [manual.id],
    });

    const conflict = await relatedRepoMemory(project, manual.id);
    expect(conflict?.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "conflicts-with", targetId: automated.id }),
      expect.objectContaining({ type: "superseded-by", targetId: fixed.id }),
    ]));
  });

  it("returns a compact chronological projection and query filter", async () => {
    const timeline = await repoMemoryTimeline(project, { query: "reconnect", includeHistory: true, limit: 10 });
    expect(timeline.length).toBeGreaterThanOrEqual(3);
    expect(timeline.every((event) => event.summary.length <= 600)).toBe(true);
    expect(timeline.every((event) => event.title.toLowerCase().includes("reconnect") || event.summary.toLowerCase().includes("reconnect"))).toBe(true);
  });

  it("exports and imports portable redacted memory without requiring an external service", async () => {
    const bundle = await exportRepoMemoryBundle(project, true);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.records.length).toBeGreaterThanOrEqual(3);
    await expect(importRepoMemoryBundle(target, bundle)).resolves.toMatchObject({ imported: bundle.records.length, skipped: 0 });
    await expect(importRepoMemoryBundle(target, bundle)).resolves.toMatchObject({ imported: 0, skipped: bundle.records.length });
    const imported = await repoMemoryTimeline(target, { includeHistory: true, limit: 10 });
    expect(imported.length).toBe(bundle.records.length);
  });
});
