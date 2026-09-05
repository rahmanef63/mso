import { afterAll, beforeEach, describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-memory-test-"));
const file = path.join(directory, "memory.json");
process.env.OS_MEMORY_STORE = file;
const { addMemory, recall, listMemories, removeMemory } = await import("./legacy-owner-memory");
beforeEach(async () => { await fs.rm(file, { force: true }); });
afterAll(async () => { delete process.env.OS_MEMORY_STORE; await fs.rm(directory, { recursive: true, force: true }); });

describe("owner memory store + recall", () => {
  it("adds, recalls by word overlap, and removes", async () => {
    const a = await addMemory("I deploy mso with the guarded release command");
    await addMemory("My favorite color is blue");
    const joined = (await recall("how do I deploy?")).map((m) => m.text).join();
    expect(joined).toMatch(/deploy/); expect(joined).not.toMatch(/color/);
    await removeMemory(a.id); expect((await listMemories()).some((m) => m.id === a.id)).toBe(false);
  });
  it("falls back to recent facts when the query has no long words", async () => {
    await addMemory("Keep this user fact as data"); expect(await recall("a b")).toHaveLength(1);
  });
  it("serializes parallel additions without losing a fact", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => addMemory(`Concurrent fact ${i}`)));
    const rows = await listMemories(); expect(rows).toHaveLength(12); expect(new Set(rows.map((x) => x.id)).size).toBe(12);
  });
  it("refuses malformed existing state rather than overwriting it", async () => {
    await fs.writeFile(file, "invalid existing content", { mode: 0o600 });
    await expect(addMemory("new data")).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("invalid existing content");
  });
  it("refuses symlinked state without changing the target", async () => {
    const victim = path.join(directory, "victim.json"); await fs.writeFile(victim, "[]", { mode: 0o600 });
    await fs.symlink(victim, file);
    await expect(addMemory("do not follow symlinks")).rejects.toThrow();
    expect(await fs.readFile(victim, "utf8")).toBe("[]");
  });
  it("rejects empty or control-character input and keeps arbitrary text non-executable", async () => {
    await expect(addMemory("  ")).rejects.toThrow(); await expect(addMemory("bad\0text")).rejects.toThrow();
    const literal = "User fact: <script>example()</script>; $(not-executed)";
    const memory = await addMemory(literal); expect((await listMemories())[0].text).toBe(literal);
    const stored = JSON.parse(await fs.readFile(file, "utf8"));
    expect(Object.keys(stored[0]).sort()).toEqual(["createdAt", "id", "text"]);
    expect(stored[0].id).toBe(memory.id);
  });
});
