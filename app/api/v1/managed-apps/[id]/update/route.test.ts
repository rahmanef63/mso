import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  isDemo: { current: false },
  rateLimited: vi.fn(() => false),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  cachedUpdateStatus: vi.fn((_id: string) => ({ currentVersion: "1.0.0", updateAvailable: true })),
  checkUpdate: vi.fn(async (_id: string, _force: boolean) => ({ updateAvailable: true, latestVersion: "1.1.0" })),
  startUpdate: vi.fn(async (_id: string, _opts: unknown) => ({ id: "job-update-1234567890abcdef", argv: ["update"] })),
  rememberJobActor: vi.fn(),
  audit: vi.fn(async () => {}),
  actor: vi.fn(async () => "dev-owner"),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/demo", () => ({
  get IS_DEMO() {
    return mocks.isDemo.current;
  },
}));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/managed-apps/catalog", () => ({
  isManagedAppId: mocks.isManagedAppId,
}));
vi.mock("@/lib/managed-apps/job-audit", () => ({
  rememberJobActor: mocks.rememberJobActor,
}));
vi.mock("@/lib/managed-apps/update", () => ({
  cachedUpdateStatus: mocks.cachedUpdateStatus,
  checkUpdate: mocks.checkUpdate,
  startUpdate: mocks.startUpdate,
  setChannel: vi.fn(),
  startRollback: vi.fn(),
  startUninstall: vi.fn(),
}));

import { GET, POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const getReq = (id: string) => new Request(`https://mso.example.com/api/v1/managed-apps/${id}/update`);
const postReq = (id: string, body: unknown) =>
  new Request(`https://mso.example.com/api/v1/managed-apps/${id}/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/v1/managed-apps/[id]/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuth.mockResolvedValue(true);
    mocks.isDemo.current = false;
    mocks.rateLimited.mockReturnValue(false);
  });

  describe("GET", () => {
    it("returns 401 when unauthenticated", async () => {
      mocks.verifyAuth.mockResolvedValue(false);
      const res = await GET(getReq("hermes"), ctx("hermes"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(mocks.cachedUpdateStatus).not.toHaveBeenCalled();
    });

    it("returns 404 for unknown application id", async () => {
      const res = await GET(getReq("unknown-app"), ctx("unknown-app"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "unknown managed application" });
      expect(mocks.cachedUpdateStatus).not.toHaveBeenCalled();
    });

    it("returns cached update status on happy path", async () => {
      const res = await GET(getReq("hermes"), ctx("hermes"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ currentVersion: "1.0.0", updateAvailable: true });
    });
  });

  describe("POST", () => {
    it("returns 401 when unauthenticated", async () => {
      mocks.verifyAuth.mockResolvedValue(false);
      const res = await POST(postReq("hermes", { action: "check" }), ctx("hermes"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(mocks.checkUpdate).not.toHaveBeenCalled();
    });

    it("returns 403 in demo mode", async () => {
      mocks.isDemo.current = true;
      const res = await POST(postReq("hermes", { action: "apply" }), ctx("hermes"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "managed application actions are disabled in demo mode" });
      expect(mocks.startUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 for unknown application id", async () => {
      const res = await POST(postReq("unknown-app", { action: "check" }), ctx("unknown-app"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "unknown managed application" });
    });

    it("returns 400 for unsupported action", async () => {
      const res = await POST(postReq("hermes", { action: "invalid-action" }), ctx("hermes"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unsupported managed application action" });
    });

    it("returns 429 when rate limited", async () => {
      mocks.rateLimited.mockReturnValue(true);
      const res = await POST(postReq("hermes", { action: "check" }), ctx("hermes"));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "too many operations" });
    });

    it("returns 200 for action check on happy path", async () => {
      const res = await POST(postReq("hermes", { action: "check" }), ctx("hermes"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: { updateAvailable: true, latestVersion: "1.1.0" } });
    });

    it("returns 202 with job for action apply on happy path", async () => {
      const res = await POST(postReq("hermes", { action: "apply" }), ctx("hermes"));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ job: { id: "job-update-1234567890abcdef", argv: ["update"] } });
      expect(mocks.rememberJobActor).toHaveBeenCalledWith("job-update-1234567890abcdef", "dev-owner");
    });
  });
});
