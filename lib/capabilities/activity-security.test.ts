import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-activity-security-"));
const file = path.join(directory, "activity.jsonl");
process.env.OS_MCP_ACTIVITY_LOG = file;
const { recordCapabilityActivity, readCapabilityActivity } = await import("./activity");
beforeEach(async () => { await fs.rm(file, { force: true }); });
afterAll(async () => { delete process.env.OS_MCP_ACTIVITY_LOG; await fs.rm(directory, { recursive: true, force: true }); });

describe("private activity metadata persistence", () => {
  it("projects approved fields and redacts text without persisting request bodies", async () => {
    const entry = { id: "test", tool: "fs_write", state: "completed" as const, target: "token=synthetic-value", detail: "password=synthetic-value", content: "request-body-not-for-log", arbitrary: "do-not-keep" };
    await recordCapabilityActivity(entry);
    const raw = await fs.readFile(file, "utf8");
    expect(raw).not.toContain("synthetic-value"); expect(raw).not.toContain("request-body-not-for-log"); expect(raw).not.toContain("arbitrary");
    expect((await readCapabilityActivity(1))[0].target).toBe("token=[redacted]");
  });
  it("leaves symlink destinations untouched and isolates diagnostic failures", async () => {
    const victim = path.join(directory, "victim"); await fs.writeFile(victim, "untouched", { mode: 0o600 }); await fs.symlink(victim, file);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await recordCapabilityActivity({ id: "refused", tool: "fs_write", state: "completed" });
      expect(await fs.readFile(victim, "utf8")).toBe("untouched"); expect(log).toHaveBeenCalled();
      await expect(readCapabilityActivity()).rejects.toThrow();
    } finally { log.mockRestore(); }
  });
  it("rejects invalid identities and oversized metadata cannot grow an unbounded record", async () => {
    expect(() => recordCapabilityActivity({ id: "bad\nrow", tool: "fs_write", state: "completed" })).toThrow();
    await recordCapabilityActivity({ id: "bounded", tool: "fs_write", state: "completed", detail: "x".repeat(20000) });
    expect(Buffer.byteLength(await fs.readFile(file))).toBeLessThan(1024);
  });
});
