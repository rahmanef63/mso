import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(os.tmpdir(), "mso-workflow-cache-"));
process.env.OS_AGENT_SESSIONS_DIR = dir;
const cache = await import("./cache-store");
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe("workflow private cache", () => {
  it("isolates principals and supports get/set/delete", async () => {
    expect((await cache.workflowCacheGet("owner-a", "key")).hit).toBe(false);
    await cache.workflowCacheSet("owner-a", "key", { value: 7 }, 60);
    expect(await cache.workflowCacheGet("owner-a", "key")).toMatchObject({ hit: true, value: { value: 7 } });
    expect((await cache.workflowCacheGet("owner-b", "key")).hit).toBe(false);
    expect(await cache.workflowCacheDelete("owner-a", "key")).toEqual({ removed: true });
    expect((await cache.workflowCacheGet("owner-a", "key")).hit).toBe(false);
  });

  it("expires TTL entries", async () => {
    await cache.workflowCacheSet("owner-a", "short", "value", 1);
    expect((await cache.workflowCacheGet("owner-a", "short")).hit).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await cache.workflowCacheGet("owner-a", "short")).hit).toBe(false);
  });

  it("rejects oversized values", async () => {
    await expect(cache.workflowCacheSet("owner-a", "huge", "x".repeat(70 * 1024), 60)).rejects.toThrow("64 KiB");
  });
});
