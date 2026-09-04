import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: { current: { role: "owner", session: { device_id: "owner-device" } } as null | { role: string; session: { device_id: string } } },
  readConfig: vi.fn(), listProjects: vi.fn(), resolveProjectHint: vi.fn(), projectGitSnapshot: vi.fn(), inspectProject: vi.fn(),
  readServers: vi.fn(), publicServers: vi.fn(), detectConvex: vi.fn(), readKnowledge: vi.fn(), repoMemory: vi.fn(),
  sessions: vi.fn(), agents: vi.fn(), memories: vi.fn(), typed: vi.fn(), telemetry: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: vi.fn(async () => mocks.context.current) }));
vi.mock("@/lib/config/store", () => ({ readConfig: mocks.readConfig, DEFAULT_PROVIDER: "anthropic" }));
vi.mock("@/lib/models/defaults", () => ({ defaultModelFor: vi.fn(() => "default-model") }));
vi.mock("@/lib/host/projects-api", () => ({
  listProjects: mocks.listProjects, resolveProjectHint: mocks.resolveProjectHint, projectGitSnapshot: mocks.projectGitSnapshot,
  inspectProject: mocks.inspectProject, readProjectMcpServers: mocks.readServers, publicProjectMcpServers: mocks.publicServers,
  detectProjectConvex: mocks.detectConvex, readProjectKnowledge: mocks.readKnowledge,
}));
vi.mock("@/lib/orchestration/repo-memory", () => ({ searchRepoMemory: mocks.repoMemory }));
vi.mock("@/lib/agent/session-query", () => ({ ownerSessionSummaries: mocks.sessions }));
vi.mock("@/lib/agent/local-agent-directory", () => ({ listLocalAgents: mocks.agents }));
vi.mock("@/lib/agent/legacy-owner-memory", () => ({ listMemories: mocks.memories }));
vi.mock("@/lib/agent/memory-store", () => ({ queryAgentMemory: mocks.typed, agentMemoryTelemetry: mocks.telemetry }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.current = { role: "owner", session: { device_id: "owner-device" } };
  mocks.readConfig.mockResolvedValue({ provider: "openai", model: "gpt-test", tokenSaver: "ponytail" });
  mocks.listProjects.mockResolvedValue({ total: 1, hasMore: false, scan: { truncated: false }, projects: [{ id: "root/mso", name: "mso", path: "/srv/mso", packageName: "mso", git: { branch: "main", head: "abcdef" } }] });
  mocks.sessions.mockResolvedValue([{ id: "s1", name: "luna", source: "cli", title: "Debug updater", updatedAt: "2026-09-04T00:00:00Z", estimatedTokens: 1200, eventCount: 4 }]);
  mocks.agents.mockResolvedValue([{ id: "s2", name: "milo", label: "[milo]", status: "idle", title: "Worker", lastSeenAt: "2026-09-04T00:00:00Z" }]);
  mocks.memories.mockResolvedValue([{ id: "legacy1", text: "prefers concise output", createdAt: 1 }]);
  mocks.typed.mockResolvedValue({ records: [
    { record: { id: "m1", document: "USER.md", key: "editor", value: "zed", kind: "semantic", confidence: 1, sensitivity: "normal", provenance: { authority: "explicit", observedAt: "2026-09-04T00:00:00Z" } }, conflicts: [] },
    { record: { id: "m2", document: "MEMORY.md", key: "secret", value: "do-not-leak", kind: "semantic", confidence: 1, sensitivity: "private", provenance: { authority: "explicit", observedAt: "2026-09-04T00:00:00Z" } }, conflicts: [] },
  ] });
  mocks.telemetry.mockResolvedValue({ liveRecords: 2, archivedRecords: 4, totalRecords: 6, resolvedKeys: 2, conflictKeys: 0, futureScheduled: 0, archiveSegments: 1 });
});

describe("Alfa cockpit read model", () => {
  it("requires owner role before reading host state", async () => {
    mocks.context.current = { role: "operator", session: { device_id: "operator" } };
    const response = await GET(new NextRequest("http://localhost/api/v1/alfa/cockpit"));
    expect(response.status).toBe(403);
    expect(mocks.listProjects).not.toHaveBeenCalled();
  });

  it("aggregates existing SSOT domains and masks non-normal typed memory values", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/alfa/cockpit"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model).toEqual({ provider: "openai", model: "gpt-test", tokenSaver: "ponytail" });
    expect(body.projects.rows[0]).toMatchObject({ id: "root/mso", name: "mso" });
    expect(body.sessions[0]).toMatchObject({ name: "luna", source: "cli" });
    expect(body.localAgents[0]).toMatchObject({ label: "[milo]", status: "idle" });
    expect(body.typedMemory.records[0]).toMatchObject({ key: "editor", value: "zed" });
    expect(body.typedMemory.records[1]).toMatchObject({ key: "Private memory", value: "Private memory", sensitivity: "private" });
    expect(body.legacyMemoryCount).toBe(1);
    expect(body.memories).toBeUndefined();
    expect(mocks.agents).toHaveBeenCalledWith("cli:owner-device", { includeOffline: false });
  });

  it("searches projects without loading the heavier cockpit domains", async () => {
    mocks.listProjects.mockResolvedValueOnce({ total: 1, hasMore: false, scan: { truncated: false }, projects: [{ id: "root/alpha", name: "alpha", path: "/srv/alpha" }] });
    const response = await GET(new NextRequest("http://localhost/api/v1/alfa/cockpit?q=alpha"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ projects: { rows: [{ id: "root/alpha", name: "alpha" }] } });
    expect(mocks.listProjects).toHaveBeenCalledWith({ query: "alpha", limit: 30 });
    expect(mocks.readConfig).not.toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.typed).not.toHaveBeenCalled();
  });

  it("adds a compact selected-project snapshot without returning raw knowledge content", async () => {
    mocks.resolveProjectHint.mockResolvedValue({ id: "root/mso", name: "mso", path: "/srv/mso", rootId: "root", root: "/srv", aliases: [] });
    mocks.projectGitSnapshot.mockResolvedValue({ available: true, branch: "main", clean: false, head: { sha: "abcdef123456", subject: "change" } });
    mocks.inspectProject.mockResolvedValue({ package: { name: "mso", version: "1.0.0" }, capabilities: { mcp: true } });
    mocks.readServers.mockResolvedValue([{ name: "github" }]);
    mocks.publicServers.mockReturnValue([{ name: "github" }]);
    mocks.detectConvex.mockResolvedValue({ detected: true, configured: true, mode: "self-hosted" });
    mocks.readKnowledge.mockResolvedValue({ exists: true, bytes: 123, sha256: "deadbeef", content: "private project knowledge" });
    mocks.repoMemory.mockResolvedValue([{ score: 0.9, record: { id: "rm1", kind: "decision", status: "confirmed", title: "Use bounded context", result: "raw result must stay server-side", updatedAt: "2026-09-04T00:00:00Z" } }]);

    const response = await GET(new NextRequest("http://localhost/api/v1/alfa/cockpit?project=root%2Fmso"));
    const body = await response.json();
    expect(body.selectedProject).toMatchObject({
      project: { id: "root/mso", name: "mso" },
      git: { branch: "main", clean: false },
      knowledge: { exists: true, bytes: 123, sha256: "deadbeef" },
      recentMemory: [{ title: "Use bounded context", kind: "decision" }],
    });
    expect(JSON.stringify(body.selectedProject)).not.toContain("private project knowledge");
    expect(JSON.stringify(body.selectedProject)).not.toContain("raw result must stay server-side");
  });
});
