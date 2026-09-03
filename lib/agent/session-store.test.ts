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

  it("allows an explicit rename to replace a manual title and refresh modified time", async () => {
    const session = await store.createAgentSession("principal:rename", "cli", { title: "Old name", titleSource: "manual" });
    const before = session.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const renamed = await store.renameAgentSession("principal:rename", session.id, "New name");
    expect(renamed.title).toBe("New name");
    expect(renamed.titleSource).toBe("manual");
    expect(renamed.updatedAt.localeCompare(before)).toBeGreaterThan(0);
  });

  it("allocates unique short names and renames the handle without changing the title", async () => {
    const principal = "principal:session-name";
    const first = await store.createAgentSession(principal, "cli", { title: "Keep this title", titleSource: "manual" });
    const second = await store.createAgentSession(principal, "cli");
    expect(first.name).toMatch(/^[a-z][a-z0-9-]{1,23}$/);
    expect(second.name).toMatch(/^[a-z][a-z0-9-]{1,23}$/);
    expect(first.name).not.toBe(second.name);
    const renamed = await store.renameAgentSessionName(principal, first.id, "milo-test");
    expect(renamed).toMatchObject({ name: "milo-test", title: "Keep this title", titleSource: "manual" });
    await expect(store.renameAgentSessionName(principal, second.id, "milo-test")).rejects.toThrow(/already in use/i);
  });

  it("repairs the legacy CLI default that was incorrectly stored as a manual title", async () => {
    const session = await store.createAgentSession("principal:legacy-title", "cli", { title: "MSO Agent session", titleSource: "manual" });
    const updated = await store.updateAgentSessionHistory("principal:legacy-title", session.id, [{ role: "user", text: "Deploy Example Service" }], "Deploy Example Service", "auto");
    expect(updated.title).toBe("Deploy Example Service");
    expect(updated.titleSource).toBe("auto");
  });

  it("keeps manual titles locked against later auto-title hints", async () => {
    const session = await store.createAgentSession("principal:title", "cli", { title: "Manual name", titleSource: "manual" });
    await store.maybeAutoTitleAgentSession("principal:title", session.id, "Deploy a very different project");
    const current = await store.getAgentSession("principal:title", session.id);
    expect(current?.title).toBe("Manual name");
    expect(current?.titleSource).toBe("manual");
  });

  it("deduplicates parallel calls for one conversation without a global session lock", async () => {
    const principal = "principal:parallel-same";
    const hash = "a".repeat(64);
    const rows = await Promise.all(Array.from({ length: 32 }, () =>
      store.findOrCreateAgentSessionForConversation(principal, hash, "Parallel conversation"),
    ));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    const listed = await store.listAgentSessions(principal, 100);
    expect(listed).toHaveLength(1);
    expect(listed[0].source).toBe("mcp");
  });

  it("lets unrelated conversations create sessions concurrently", async () => {
    const principal = "principal:parallel-many";
    const hashes = Array.from({ length: 24 }, (_, i) => i.toString(16).padStart(64, "0"));
    const rows = await Promise.all(hashes.map((hash) =>
      store.findOrCreateAgentSessionForConversation(principal, hash, `Conversation ${hash.slice(-2)}`),
    ));
    expect(new Set(rows.map((row) => row.id)).size).toBe(hashes.length);
    expect(new Set(rows.map((row) => row.name)).size).toBe(hashes.length);
    expect(await store.listAgentSessions(principal, 100)).toHaveLength(hashes.length);
  });

  it("backfills legacy conversation refs once and marks the hot-path index ready", async () => {
    const principal = "principal:legacy-index";
    const hash = "f".repeat(64);
    const legacy = await store.createAgentSession(principal, "mcp", {
      title: "Legacy indexed conversation", conversationHash: hash,
    });
    const files = await import("./session-files");
    expect(await files.conversationIndexReady()).toBe(false);
    const backfill = await files.backfillConversationIndex();
    expect(backfill.conversations).toBeGreaterThan(0);
    expect(await files.conversationIndexReady()).toBe(true);
    const resolved = await store.findOrCreateAgentSessionForConversation(principal, hash, "Should not duplicate");
    expect(resolved.id).toBe(legacy.id);
  });

});
