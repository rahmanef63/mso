import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/require-session";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(async (): Promise<SessionContext | null> => null),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.getSessionContext,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionContext.mockResolvedValue(null);
});

describe("GET /api/auth/me — live shell authorization probe", () => {
  it("returns authenticated: false and null fields when no session exists", async () => {
    // Shell boots against this unauthenticated state; returning 401 or throwing breaks startup.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      authenticated: false,
      deviceId: null,
      deviceLabel: null,
      role: null,
    });
  });

  it("returns authenticated: true with owner role and device information", async () => {
    mocks.getSessionContext.mockResolvedValue({
      session: {
        device_id: "dev-owner-001",
        issued_at: 1000,
        expires_at: 2000,
        cookie_scope: "host",
        cookie_epoch: "epoch-0000000000000000",
      },
      device: {
        label: "Primary Laptop",
        approvedAt: 1000,
        role: "owner",
      },
      role: "owner",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      authenticated: true,
      deviceId: "dev-owner-001",
      deviceLabel: "Primary Laptop",
      role: "owner",
    });
  });

  it("reflects operator role when session has operator permissions", async () => {
    mocks.getSessionContext.mockResolvedValue({
      session: {
        device_id: "dev-op-002",
        issued_at: 1000,
        expires_at: 2000,
        cookie_scope: "host",
        cookie_epoch: "epoch-0000000000000000",
      },
      device: {
        label: "Operator Terminal",
        approvedAt: 1000,
        role: "operator",
      },
      role: "operator",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      authenticated: true,
      role: "operator",
    });
  });

  it("reflects viewer role when session has viewer permissions", async () => {
    mocks.getSessionContext.mockResolvedValue({
      session: {
        device_id: "dev-view-003",
        issued_at: 1000,
        expires_at: 2000,
        cookie_scope: "host",
        cookie_epoch: "epoch-0000000000000000",
      },
      device: {
        label: "Observer Screen",
        approvedAt: 1000,
        role: "viewer",
      },
      role: "viewer",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      authenticated: true,
      role: "viewer",
    });
  });
});
