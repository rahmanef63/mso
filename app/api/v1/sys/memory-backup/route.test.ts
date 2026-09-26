import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: "owner", history: vi.fn(async (_options?: unknown) => ({ items: [], nextOffset: null })), preview: vi.fn(async () => ({ files: 0 })), create: vi.fn(async () => ({ id: "snapshot" })), verify: vi.fn(async () => ({ id: "snapshot", integrity: true })) }));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: async () => true }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: async () => ({ role: mocks.role, session: { device_id: "owner" } }) }));
vi.mock("@/lib/host/request-api", () => ({ readJson: (req: Request) => req.json(), apiError: (_: string, error: Error) => Response.json({ error: error.message }, { status: 400 }) }));
vi.mock("@/lib/host/audit-api", () => ({ audit: async () => undefined }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: () => false }));
vi.mock("@/lib/host/memory-backup-api", () => ({ previewMemoryBackup: mocks.preview, createMemoryBackup: mocks.create, verifyMemoryBackup: mocks.verify, listMemoryBackups: mocks.history }));
import { GET, POST } from "./route";
const req = (body: unknown) => new Request("http://localhost/api/v1/sys/memory-backup", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { mocks.role = "owner"; vi.clearAllMocks(); });
describe("server memory backup owner API", () => {
  it("denies nonowners before preview, backup or restore", async () => { mocks.role = "operator"; expect((await GET(req({}))).status).toBe(403); expect((await POST(req({ action: "create", confirm: true }))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); });
  it("requires explicit confirmation and never accepts client source paths", async () => {
    expect((await POST(req({ action: "create" }))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
    expect((await POST(req({ action: "create", confirm: true, source: "/etc", destination: "/tmp" }))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith();
  });
  it("verifies only a referenced backup plus its expected manifest hash", async () => {
    expect((await POST(req({ action: "verify", confirm: true, id: "backup-id", manifest_sha256: "a".repeat(64) }))).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith("backup-id", "a".repeat(64));
  });
});

describe("owner backup history API", () => {
  const history = (query = "") => new Request(`http://localhost/api/v1/sys/memory-backup?view=history${query}`);
  it.each(["viewer", "operator"])("denies %s history access", async role => {
    mocks.role = role; expect((await GET(history())).status).toBe(403); expect(mocks.history).not.toHaveBeenCalled();
  });
  it("reads only metadata with no-store and explicit pagination", async () => {
    const response = await GET(history(`&offset=12&revision=${"a".repeat(64)}&source=/etc`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.history).toHaveBeenCalledWith({ offset: 12, revision: "a".repeat(64) });
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects malformed offsets and unknown views", async () => {
    for (const offset of ["-1", "1.5", "100000", "abc"]) expect((await GET(history(`&offset=${offset}`))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/v1/sys/memory-backup?view=other"))).status).toBe(400);
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("does not hide history failures as empty data", async () => {
    mocks.history.mockRejectedValueOnce(new Error("history changed; refresh"));
    const response = await GET(history()); expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "history changed; refresh" });
  });
});
