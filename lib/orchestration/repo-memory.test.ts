import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ingestManualUserTest,
  searchRepoMemory,
  updateRepoMemoryLifecycle,
  upsertRepoMemory,
} from "./repo-memory";

const roots: string[] = [];
async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-rasmic-memory-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("repo-local structured memory", () => {
  it("does not create .agent during a read-only search when memory is absent", async () => {
    const root = await project();
    await expect(searchRepoMemory(root, { query: "freeze" })).resolves.toEqual([]);
    await expect(fs.lstat(path.join(root, ".agent"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates portable task/debug/test memory and ranks current confirmed facts above stale records", async () => {
    const root = await project();
    await upsertRepoMemory(root, {
      kind: "debug",
      title: "Old freeze diagnosis",
      summary: "renderer freeze after reconnect",
      source: "agent",
      status: "active",
      confidence: 0.7,
      importance: 0.6,
      lastVerified: "2024-01-01T00:00:00Z",
      tags: ["freeze"],
    });
    const current = await upsertRepoMemory(root, {
      kind: "debug",
      title: "Confirmed freeze diagnosis",
      summary: "renderer freeze after reconnect",
      source: "agent",
      status: "confirmed",
      confidence: 0.95,
      importance: 0.9,
      lastVerified: new Date().toISOString(),
      tags: ["freeze"],
    });
    const hits = await searchRepoMemory(root, { query: "renderer freeze reconnect", limit: 5 });
    expect(hits[0].record.id).toBe(current.id);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    await expect(fs.lstat(path.join(root, ".agent", "memory", "debug"))).resolves.toMatchObject({});
  });

  it("ingests the user's failed manual test as high-confidence active test memory", async () => {
    const root = await project();
    const record = await ingestManualUserTest(root, {
      observation: "I tested the game and it still freezes after reconnect",
      result: "fail",
      environment: "mobile PWA",
      scope: ["src/game/runtime.ts"],
    });
    expect(record).toMatchObject({
      kind: "test",
      source: "user-manual",
      result: "fail",
      status: "active",
      confidence: 1,
      environment: "mobile PWA",
    });
    const [hit] = await searchRepoMemory(root, { query: "freeze reconnect", kinds: ["test"] });
    expect(hit.record.id).toBe(record.id);
    expect(hit.record.failed).toContain("still freezes");
  });

  it("redacts credentials before persistence", async () => {
    const root = await project();
    const record = await upsertRepoMemory(root, {
      kind: "task",
      title: "Deploy check",
      summary: "Authorization: Bearer ghp_1234567890abcdef and token=top-secret-value",
      source: "system",
    });
    expect(JSON.stringify(record)).not.toContain("1234567890abcdef");
    expect(JSON.stringify(record)).not.toContain("top-secret-value");
    const body = (await searchRepoMemory(root, { query: "deploy", kinds: ["task"] }))[0].record;
    expect(JSON.stringify(body)).toContain("[redacted]");
  });

  it("supersedes old memory and excludes it from default retrieval", async () => {
    const root = await project();
    const old = await upsertRepoMemory(root, {
      kind: "decision",
      title: "Old deployment decision",
      summary: "use route A",
      source: "agent",
      status: "confirmed",
    });
    const replacement = await upsertRepoMemory(root, {
      kind: "decision",
      title: "New deployment decision",
      summary: "use route B",
      source: "agent",
      status: "confirmed",
      supersedes: [old.id],
    });
    const current = await searchRepoMemory(root, { query: "deployment decision", kinds: ["decision"] });
    expect(current.map((hit) => hit.record.id)).toEqual([replacement.id]);
    const history = await searchRepoMemory(root, { query: "deployment decision", kinds: ["decision"], includeHistory: true });
    expect(history.map((hit) => hit.record.id)).toEqual(expect.arrayContaining([replacement.id, old.id]));
    expect(history.find((hit) => hit.record.id === old.id)?.record.status).toBe("superseded");
  });

  it("supports explicit lifecycle updates", async () => {
    const root = await project();
    const record = await upsertRepoMemory(root, {
      kind: "failure", title: "Temporary failure", summary: "failed once", source: "agent",
    });
    const archived = await updateRepoMemoryLifecycle(root, record.id, "archived");
    expect(archived.status).toBe("archived");
    await expect(searchRepoMemory(root, { query: "temporary failure" })).resolves.toEqual([]);
  });
  it("ranks a current failed manual user test above a conflicting automated pass", async () => {
    const root = await project();
    await upsertRepoMemory(root, {
      kind: "test", title: "Reconnect automated smoke", summary: "reconnect freeze check",
      source: "automation", result: "pass", status: "confirmed", confidence: 1, importance: 0.9,
      lastVerified: new Date().toISOString(), tags: ["reconnect", "freeze"],
    });
    const manual = await ingestManualUserTest(root, {
      observation: "I tested reconnect and it still freezes", result: "fail", tags: ["reconnect", "freeze"],
    });
    const hits = await searchRepoMemory(root, { query: "reconnect freeze", kinds: ["test"] });
    expect(hits[0].record.id).toBe(manual.id);
    expect(hits[0].record).toMatchObject({ source: "user-manual", result: "fail" });
  });

  it("normalizes caller-provided record ids so they cannot escape the memory directory", async () => {
    const root = await project();
    const record = await upsertRepoMemory(root, {
      id: "../../outside", kind: "task", title: "Safe id", summary: "must stay inside .agent", source: "agent",
    });
    expect(record.id).not.toContain("/");
    await expect(fs.lstat(path.join(root, "outside.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const files = await fs.readdir(path.join(root, ".agent/memory/tasks"));
    expect(files).toHaveLength(1);
  });

  it("refuses nested symlink escapes during read-only retrieval", async () => {
    const root = await project();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mso-rasmic-outside-"));
    roots.push(outside);
    await fs.mkdir(path.join(root, ".agent/memory"), { recursive: true });
    await fs.symlink(outside, path.join(root, ".agent/memory/debug"));
    await expect(searchRepoMemory(root, { query: "secret", kinds: ["debug"] })).rejects.toThrow(/not a safe directory/i);
  });

});
