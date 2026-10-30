import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionContext: vi.fn(async (): Promise<{ role: string; session: { device_id: string } } | null> => ({
    role: "owner",
    session: { device_id: "dev-owner" },
  })),
  openIntegrationSetup: vi.fn(async (provider: string, deviceId: string) => ({
    token: "grant-token-123",
    provider,
    deviceId,
  })),
  audit: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.sessionContext,
}));
vi.mock("@/lib/infra/setup-capability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/infra/setup-capability")>();
  return {
    ...actual,
    openIntegrationSetup: mocks.openIntegrationSetup,
  };
});
vi.mock("@/lib/host/audit-api", () => ({
  audit: mocks.audit,
}));

import { POST } from "./route";

const postReq = (body: unknown) =>
  new NextRequest("https://mso.example.com/api/v1/infra/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/v1/infra/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionContext.mockResolvedValue({
      role: "owner",
      session: { device_id: "dev-owner" },
    } as never);
    mocks.openIntegrationSetup.mockResolvedValue({
      token: "grant-token-123",
      provider: "dokploy",
      deviceId: "dev-owner",
    } as never);
  });

  it("returns 403 when session is non-owner", async () => {
    mocks.sessionContext.mockResolvedValueOnce({
      role: "operator",
      session: { device_id: "dev-op" },
    } as never);
    const res = await POST(postReq({ provider: "dokploy" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.openIntegrationSetup).not.toHaveBeenCalled();
  });

  it("returns 403 when session is null (finding: collapses 401 into 403)", async () => {
    mocks.sessionContext.mockResolvedValueOnce(null);
    const res = await POST(postReq({ provider: "dokploy" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.openIntegrationSetup).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid body fields", async () => {
    const res = await POST(postReq({ invalidKey: "value" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "setup_unavailable" });
    expect(mocks.openIntegrationSetup).not.toHaveBeenCalled();
  });

  it("opens integration setup and returns grant on happy path", async () => {
    const res = await POST(postReq({ provider: "dokploy" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("grant-token-123");
    expect(body.setupUrl).toContain("/integrations");
    expect(mocks.openIntegrationSetup).toHaveBeenCalledWith("dokploy", "dev-owner", undefined, expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "infra.write", actor: "dev-owner", target: "dokploy" }),
    );
  });
});
