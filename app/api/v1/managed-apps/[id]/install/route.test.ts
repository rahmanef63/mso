import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  isDemo: { current: false },
  rateLimited: vi.fn(() => false),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  startInstall: vi.fn(async (_id: string, _opts: unknown) => ({
    id: "job-install-1234567890abcdef",
    argv: ["install", "--provider", "openai"],
  })),
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
vi.mock("@/lib/managed-apps/install", () => ({
  startInstall: mocks.startInstall,
}));
vi.mock("@/lib/managed-apps/job-audit", () => ({
  rememberJobActor: mocks.rememberJobActor,
}));

import { POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const postReq = (id: string, body: unknown) =>
  new Request(`https://mso.example.com/api/v1/managed-apps/${id}/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/v1/managed-apps/[id]/install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuth.mockResolvedValue(true);
    mocks.isDemo.current = false;
    mocks.rateLimited.mockReturnValue(false);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await POST(postReq("hermes", { provider: "openai" }), ctx("hermes"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.startInstall).not.toHaveBeenCalled();
  });

  it("returns 403 in demo mode", async () => {
    mocks.isDemo.current = true;
    const res = await POST(postReq("hermes", { provider: "openai" }), ctx("hermes"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "managed application actions are disabled in demo mode" });
    expect(mocks.startInstall).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown application id", async () => {
    const res = await POST(postReq("unknown-app", { provider: "openai" }), ctx("unknown-app"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.startInstall).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await POST(postReq("hermes", { provider: "openai" }), ctx("hermes"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too many operations" });
    expect(mocks.startInstall).not.toHaveBeenCalled();
  });

  it("returns 400 for bad request fields", async () => {
    const res = await POST(postReq("hermes", { apiKey: 12345 }), ctx("hermes"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported request field" });
  });

  it("starts install and returns 202 on happy path", async () => {
    const res = await POST(postReq("hermes", { provider: "openai", apiKey: "sk-test" }), ctx("hermes"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      job: { id: "job-install-1234567890abcdef", argv: ["install", "--provider", "openai"] },
    });
    expect(mocks.rememberJobActor).toHaveBeenCalledWith("job-install-1234567890abcdef", "dev-owner");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "managed-app.action", target: "hermes", ok: true, detail: "install.start" }),
    );
  });

  it("returns 409 when installation fails to start", async () => {
    mocks.startInstall.mockRejectedValueOnce(new Error("lock contention"));
    const res = await POST(postReq("hermes", { provider: "openai" }), ctx("hermes"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "lock contention" });
  });
});
