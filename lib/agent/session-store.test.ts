import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-agent-session-p0-"));
const sessions = path.join(root, "sessions");
const memory = path.join(root, "memory");
const archives = path.join(root, "archives");

process.env.OS_AGENT_SESSIONS_DIR = sessions;
process.env.OS_AGENT_MEMORY_DIR = memory;
process.env.OS_AGENT_SESSION_ARCHIVE_DIR = archives;
process.env.OS_AGENT_SESSION_COMPACT_TOKENS = "10000";
process.env.OS_AGENT_SESSION_RECENT_TOKENS = "5000";
process.env.OS_AGENT_SESSION_ARCHIVE_DAYS = "30";
afterAll(async () => {
  for (const key of ["OS_AGENT_SESSIONS_DIR", "OS_AGENT_MEMORY_DIR", "OS_AGENT_SESSION_ARCHIVE_DIR", "OS_AGENT_SESSION_COMPACT_TOKENS", "OS_AGENT_SESSION_RECENT_TOKENS", "OS_AGENT_SESSION_ARCHIVE_DAYS"]) delete process.env[key];
  await fs.rm(root, { recursive: true, force: true });
});

// Import after env setup so module-level secure paths point only at this fixture.
vi.resetModules();
const store = await import("./session-store");
const archive = await import("./session-archive");

describe("durable agent session context policy", () => {
  it("compacts at the token threshold, archives a sanitized backup, and tracks timestamps/counters", async () => {
    const session = await store.createAgentSession("principal:compact", "cli", { title: "Compaction test" });
    const history = Array.from({ length: 28 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `${i} deployment decision api_key=should-not-survive ${"x".repeat(2200)}`,
    }));
    const compacted = await store.updateAgentSessionHistory("principal:compact", session.id, history);
    expect(compacted.compactionCount).toBe(1);
    expect(compacted.archiveCount).toBe(1);
    expect(compacted.lastCompactedAt).toMatch(/T/);
    expect(compacted.lastArchivedAt).toMatch(/T/);
    expect(compacted.contextSummary).toContain("MSO session context compacted");
    expect(compacted.estimatedTokens).toBeLessThan(compacted.compactThresholdTokens);
    expect(compacted.lifetimeEstimatedTokens).toBeGreaterThan(compacted.estimatedTokens);

    const files = (await fs.readdir(archives)).filter((name) => name.endsWith(".json.gz"));
    expect(files).toHaveLength(1);
    const archived = (await gunzipAsync(await fs.readFile(path.join(archives, files[0])))).toString("utf8");
    expect(archived).not.toContain("should-not-survive");
    expect(archived).toContain("[redacted]");
  });

  it("prunes archives older than the default 30-day retention window", async () => {
    const [name] = (await fs.readdir(archives)).filter((row) => row.endsWith(".json.gz"));
    const file = path.join(archives, name);
    const old = new Date(Date.now() - 31 * 86_400_000);
    await fs.utimes(file, old, old);
    const result = await archive.pruneAgentSessionArchives();
    expect(result.removed).toBe(1);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps manual titles locked against later auto-title hints", async () => {
    const session = await store.createAgentSession("principal:title", "cli", { title: "Manual name", titleSource: "manual" });
    await store.maybeAutoTitleAgentSession("principal:title", session.id, "Deploy a very different project");
    const current = await store.getAgentSession("principal:title", session.id);
    expect(current?.title).toBe("Manual name");
    expect(current?.titleSource).toBe("manual");
  });
});
