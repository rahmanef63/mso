import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";

process.env.OS_MEMORY_STORE = path.join(os.tmpdir(), `mso-memory-test-${process.pid}.json`);
const { addMemory, recall, listMemories, removeMemory } = await import("./legacy-owner-memory");

describe("memory store + recall", () => {
  it("adds, recalls by word overlap, and removes", async () => {
    const a = await addMemory("I deploy mso with bun run build then restart");
    await addMemory("My favorite color is blue");

    const hits = await recall("how do I deploy?");
    const joined = hits.map((m) => m.text).join();
    expect(joined).toMatch(/deploy/);
    expect(joined).not.toMatch(/color/); // "deploy" doesn't overlap the color fact

    await removeMemory(a.id);
    expect((await listMemories()).some((m) => m.id === a.id)).toBe(false);
  });

  it("falls back to recent facts when the query has no ≥3-char words", async () => {
    expect(Array.isArray(await recall("a b"))).toBe(true);
  });
});
