import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async (_role?: string) => true),
  doctorInfraProvider: vi.fn(async (id: string) => ({ id, ok: true, message: "ready" })),
  withIntegrationSelection: vi.fn(async (_sel: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra", () => ({
  INFRA_PROVIDER_IDS: ["dokploy", "cloudflare", "hostinger"],
  isInfraProviderId: (id: string) => ["dokploy", "cloudflare", "hostinger"].includes(id),
  doctorInfraProvider: mocks.doctorInfraProvider,
}));
vi.mock("@/lib/infra/connection-service", () => ({
  withIntegrationSelection: mocks.withIntegrationSelection,
}));

import { POST } from "./route";

const postReq = (body?: unknown) =>
  new NextRequest("https://mso.example.com/api/v1/infra/providers/doctor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("POST /api/v1/infra/providers/doctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(true);
    mocks.doctorInfraProvider.mockResolvedValue({ id: "dokploy", ok: true, message: "ready" });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const res = await POST(postReq({ id: "dokploy" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.doctorInfraProvider).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown provider id", async () => {
    const res = await POST(postReq({ id: "unknown-provider" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown infrastructure provider" });
    expect(mocks.doctorInfraProvider).not.toHaveBeenCalled();
  });

  it("runs doctor check and returns results on happy path", async () => {
    const res = await POST(postReq({ id: "dokploy" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual({ id: "dokploy", ok: true, message: "ready" });
    expect(mocks.doctorInfraProvider).toHaveBeenCalledWith("dokploy");
  });
});
