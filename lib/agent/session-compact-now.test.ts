import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { NextRequest } from "next/server";

let mockRole: string | null = "owner";
let mockDeviceId = "dev-compact-route";

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: async () =>
    mockRole ? { session: { device_id: mockDeviceId }, device: { id: mockDeviceId, role: mockRole }, role: mockRole } : null,
}));

const gunzipAsync = promisify(gunzip);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-agent-compact-now-"));
await fs.chmod(root, 0o700);
const sessions = path.join(root, "sessions");
const memory = path.join(root, "memory");
const archives = path.join(root, "archives");
const preservation = path.join(root, "preservation");

const envKeys = [
  "OS_AGENT_SESSIONS_DIR", "OS_AGENT_MEMORY_DIR", "OS_AGENT_SESSION_ARCHIVE_DIR",
  "OS_AGENT_SESSION_PRESERVATION_DIR", "OS_AGENT_SESSION_COMPACT_TOKENS",
  "OS_AGENT_SESSION_RECENT_TOKENS", "OS_AGENT_SESSION_ARCHIVE_DAYS",
] as const;

Object.assign(process.env, {
  OS_AGENT_SESSIONS_DIR: sessions,
  OS_AGENT_MEMORY_DIR: memory,
  OS_AGENT_SESSION_ARCHIVE_DIR: archives,
  OS_AGENT_SESSION_PRESERVATION_DIR: preservation,
  OS_AGENT_SESSION_COMPACT_TOKENS: "20000",
  OS_AGENT_SESSION_RECENT_TOKENS: "5000",
  OS_AGENT_SESSION_ARCHIVE_DAYS: "30",
});

afterAll(async () => {
  for (const key of envKeys) delete process.env[key];
  await fs.rm(root, { recursive: true, force: true });
});

vi.resetModules();
const store = await import("./session-store");
const archive = await import("./session-archive");
const mutations = await import("./session-mutations");
const compactNow = await import("./session-compact-now");

describe("forced on-demand agent session compaction", () => {
  it("does not automatically compact below threshold in updateAgentSessionHistory (regression guard)", async () => {
    const session = await store.createAgentSession("principal:regression", "cli", { title: "Regression test" });
    const history = Array.from({ length: 28 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `turn ${i} payload ${"x".repeat(2000)}`,
    }));
    const updated = await store.updateAgentSessionHistory("principal:regression", session.id, history);
    expect(updated.compactionCount).toBe(0);
    expect(updated.archiveCount).toBe(0);
    expect(updated.lastCompactedAt).toBeUndefined();
    expect(updated.lastArchivedAt).toBeUndefined();
    expect(updated.history).toHaveLength(28);

    const archivesList = await archive.listAgentSessionArchives();
    const sessionArchives = archivesList.filter((a) => a.name.startsWith(session.id));
    expect(sessionArchives).toHaveLength(0);
  });

  it("forces compaction on a session below threshold, archiving and shrinking", async () => {
    const session = await store.createAgentSession("principal:forced", "cli", { title: "Forced compact test" });
    const history = Array.from({ length: 28 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `turn ${i} payload ${"x".repeat(2000)}`,
    }));
    await store.updateAgentSessionHistory("principal:forced", session.id, history);

    const report = await compactNow.compactAgentSessionNow("principal:forced", session.id, "manual");
    expect(report.archived).toBe(true);
    expect(report.archiveReason).toBe("manual");
    expect(report.beforeTokens).toBeGreaterThan(10000);
    expect(report.afterTokens).toBeLessThan(report.beforeTokens);
    expect(report.archiveCount).toBe(1);
    expect(report.session.compactionCount).toBe(1);
    expect(report.session.archiveCount).toBe(1);
    expect(report.session.lastCompactedAt).toMatch(/T/);
    expect(report.session.lastArchivedAt).toMatch(/T/);
    expect(report.session.history.length).toBeLessThan(28);
  });

  it("verifies the archive exists afterwards and is readable", async () => {
    const archivesList = await archive.listAgentSessionArchives();
    expect(archivesList.length).toBe(1);
    const readBack = await archive.readAgentSessionArchive(archivesList[0].name);
    expect(readBack.schemaVersion).toBe(1);
    expect(readBack.reason).toBe("manual");
    expect(readBack.session.history).toHaveLength(28);

    const rawGz = await fs.readFile(path.join(archives, archivesList[0].name));
    const unzipped = JSON.parse((await gunzipAsync(rawGz)).toString("utf8"));
    expect(unzipped.reason).toBe("manual");
    expect(unzipped.session.history).toHaveLength(28);
  });

  it("reports nothing archived and leaves history intact when already minimal", async () => {
    const minimal = await store.createAgentSession("principal:minimal", "cli", { title: "Minimal test" });
    await store.updateAgentSessionHistory("principal:minimal", minimal.id, [{ role: "user", text: "hello world" }]);
    const report = await compactNow.compactAgentSessionNow("principal:minimal", minimal.id, "manual");
    expect(report.archived).toBe(false);
    expect(report.archiveReason).toContain("minimal");
    expect(report.beforeTokens).toBe(report.afterTokens);
    expect(report.archiveCount).toBe(0);
    expect(report.session.history).toEqual([{ role: "user", text: "hello world" }]);
  });

  it("reports nothing archived on repeat compaction after shrinking", async () => {
    const sessionsList = await store.listAgentSessions("principal:forced");
    const target = sessionsList[0];
    const initialSession = await store.getAgentSession("principal:forced", target.id);
    expect(initialSession).not.toBeNull();
    const historyBefore = [...initialSession!.history];

    const repeatReport = await compactNow.compactAgentSessionNow("principal:forced", target.id, "manual");
    expect(repeatReport.archived).toBe(false);
    expect(repeatReport.archiveReason).toContain("minimal");
    expect(repeatReport.archiveCount).toBe(1);
    expect(repeatReport.session.history).toEqual(historyBefore);

    const archivesList = await archive.listAgentSessionArchives();
    expect(archivesList.length).toBe(1);
  });

  it("verifies session-mutations re-exports compactAgentSessionNow", () => {
    expect(mutations.compactAgentSessionNow).toBe(compactNow.compactAgentSessionNow);
  });
});

describe("agent session compact route contract", () => {
  const routePromise = import("@/app/api/v1/agent-sessions/route");

  it("requires owner role", async () => {
    const { POST } = await routePromise;
    mockRole = "operator";
    const req = new NextRequest("http://localhost/api/v1/agent-sessions", {
      method: "POST", body: JSON.stringify({ action: "compact", id: "some-id" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("owner_role_required");
    mockRole = "owner";
  });

  it("requires id for compact action", async () => {
    const { POST } = await routePromise;
    mockRole = "owner";
    const req = new NextRequest("http://localhost/api/v1/agent-sessions", {
      method: "POST", body: JSON.stringify({ action: "compact" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("id_required");
  });

  it("returns 404 when session not found", async () => {
    const { POST } = await routePromise;
    mockRole = "owner";
    const req = new NextRequest("http://localhost/api/v1/agent-sessions", {
      method: "POST", body: JSON.stringify({ action: "compact", id: "20260917_010101_deadbeef" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("accepts action compact, shrinks and returns compact report", async () => {
    const { POST } = await routePromise;
    mockRole = "owner";
    const principal = `cli:${mockDeviceId}`;
    const session = await store.createAgentSession(principal, "cli", { title: "Route compact test" });
    const history = Array.from({ length: 28 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `route turn ${i} payload ${"z".repeat(2000)}`,
    }));
    await store.updateAgentSessionHistory(principal, session.id, history);

    const req = new NextRequest("http://localhost/api/v1/agent-sessions", {
      method: "POST", body: JSON.stringify({ action: "compact", id: session.id }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
    expect(body.archiveReason).toBe("manual");
    expect(body.beforeTokens).toBeGreaterThan(body.afterTokens);
    expect(body.archiveCount).toBe(1);
    expect(body.session).toBeDefined();
    expect(body.session.id).toBe(session.id);
    expect(body.session.artifacts).toBeDefined();

    const reqRepeat = new NextRequest("http://localhost/api/v1/agent-sessions", {
      method: "POST", body: JSON.stringify({ action: "compact", id: session.id }),
    });
    const resRepeat = await POST(reqRepeat);
    expect(resRepeat.status).toBe(200);
    const bodyRepeat = await resRepeat.json();
    expect(bodyRepeat.archived).toBe(false);
    expect(bodyRepeat.archiveReason).toContain("minimal");
    expect(bodyRepeat.beforeTokens).toBe(bodyRepeat.afterTokens);
    expect(bodyRepeat.archiveCount).toBe(1);
  });
});
