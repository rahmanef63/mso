import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  isDemo: { current: false },
  rateLimited: vi.fn(() => false),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  getManagedApp: vi.fn(async (id: string) => ({ id, name: id, state: "running" })),
  performManagedAppAction: vi.fn(async (id: string, action: string) => ({ id, action, state: "running" })),
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
vi.mock("@/lib/managed-apps/manager", () => ({
  getManagedApp: mocks.getManagedApp,
  performManagedAppAction: mocks.performManagedAppAction,
}));

import { GET, POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const getReq = (id: string) => new Request(`https://mso.example.com/api/v1/managed-apps/${id}`);
const postReq = (id: string, body: unknown) =>
  new Request(`https://mso.example.com/api/v1/managed-apps/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/v1/managed-apps/[id]", () => {
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
      expect(mocks.getManagedApp).not.toHaveBeenCalled();
    });

    it("returns 404 for unknown application id", async () => {
      const res = await GET(getReq("unknown-app"), ctx("unknown-app"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "unknown managed application" });
      expect(mocks.getManagedApp).not.toHaveBeenCalled();
    });

    it("returns app status on happy path", async () => {
      const res = await GET(getReq("hermes"), ctx("hermes"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ app: { id: "hermes", name: "hermes", state: "running" } });
    });
  });

  describe("POST", () => {
    it("returns 401 when unauthenticated", async () => {
      mocks.verifyAuth.mockResolvedValue(false);
      const res = await POST(postReq("hermes", { action: "start" }), ctx("hermes"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(mocks.performManagedAppAction).not.toHaveBeenCalled();
    });

    it("returns 403 in demo mode", async () => {
      mocks.isDemo.current = true;
      const res = await POST(postReq("hermes", { action: "start" }), ctx("hermes"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "managed application actions are disabled in demo mode" });
      expect(mocks.performManagedAppAction).not.toHaveBeenCalled();
    });

    it("returns 404 for unknown application id", async () => {
      const res = await POST(postReq("unknown-app", { action: "start" }), ctx("unknown-app"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "unknown managed application" });
      expect(mocks.performManagedAppAction).not.toHaveBeenCalled();
    });

    it("returns 429 when rate limited", async () => {
      mocks.rateLimited.mockReturnValue(true);
      const res = await POST(postReq("hermes", { action: "start" }), ctx("hermes"));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "too many operations" });
      expect(mocks.performManagedAppAction).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid action", async () => {
      const res = await POST(postReq("hermes", { action: "destroy-the-world" }), ctx("hermes"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unsupported managed application action" });
    });

    it("performs action and records audit on happy path", async () => {
      const res = await POST(postReq("hermes", { action: "restart" }), ctx("hermes"));
      expect(res.status).toBe(200);
      expect(mocks.performManagedAppAction).toHaveBeenCalledWith("hermes", "restart");
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "managed-app.action", target: "hermes", ok: true, detail: "restart" }),
      );
    });

    it("returns 409 when operation fails", async () => {
      mocks.performManagedAppAction.mockRejectedValueOnce(new Error("process crashed"));
      const res = await POST(postReq("hermes", { action: "restart" }), ctx("hermes"));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "managed application operation failed" });
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "managed-app.action", target: "hermes", ok: false, detail: "restart" }),
      );
    });
  });
});
