import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpFileResource, readMcpFileResource } from "./file-transfer-resource";

const ROOT = path.join(os.tmpdir(), `mso-mcp-file-resources-${process.pid}`);
beforeEach(async () => { await fs.rm(ROOT, { recursive: true, force: true }); vi.useRealTimers(); });
afterEach(async () => { vi.useRealTimers(); await fs.rm(ROOT, { recursive: true, force: true }); });

describe("principal-bound MCP file resources", () => {
  it("returns exact bytes only to the creating principal", async () => {
    const data = Buffer.from([0,1,2,3,255]);
    const resource = await createMcpFileResource({ data, filename: "x.bin", mimeType: "application/octet-stream", principal: "alice", sessionId: "session-a", maxReads: 3 });
    expect(resource.uri).toMatch(/^mso-file:\/\/[\/][a-f0-9]{48}$/);
    await expect(readMcpFileResource(resource.uri, "bob", "session-a")).rejects.toThrow(/unknown or expired/i);
    const read = await readMcpFileResource(resource.uri, "alice", "session-a");
    expect(read?.data).toEqual(data);
    expect(read?.sha256).toBe(resource.sha256);
  });
  it("enforces read exhaustion", async () => {
    const one = await createMcpFileResource({ data: Buffer.from("x"), filename: "x.txt", mimeType: "text/plain", principal: "alice", sessionId: "session-a", maxReads: 1 });
    expect((await readMcpFileResource(one.uri, "alice", "session-a"))?.data.toString()).toBe("x");
    await expect(readMcpFileResource(one.uri, "alice", "session-a")).rejects.toThrow(/unknown or expired/i);
  });
  it("expires after its TTL", async () => {
    vi.useFakeTimers();
    const now = Date.now(); vi.setSystemTime(now);
    const expiring = await createMcpFileResource({ data: Buffer.from("y"), filename: "y.txt", mimeType: "text/plain", principal: "alice", sessionId: "session-a", ttlMs: 60_000 });
    vi.setSystemTime(now + 61_000);
    await expect(readMcpFileResource(expiring.uri, "alice", "session-a")).rejects.toThrow(/unknown or expired/i);
  });
});
