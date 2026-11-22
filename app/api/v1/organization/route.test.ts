import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rateLimited: vi.fn(() => false),
  audit: vi.fn(),
  getChart: vi.fn(async () => ({ name: "Default Org", revision: "rev-1", units: [], seats: [] })),
  upsertUnit: vi.fn(async () => ({ name: "Default Org", revision: "rev-2" })),
  replaceOrg: vi.fn(async () => ({ name: "Replaced Org", revision: "rev-3" })),
  orgRuntime: vi.fn(async () => []),
  resolveSeat: vi.fn(async () => ({ id: "seat-lead", title: "Lead" })),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.session,
}));
vi.mock("@/lib/host/limits-api", () => ({
  rateLimited: mocks.rateLimited,
}));
vi.mock("@/lib/host/audit-api", () => ({
  audit: mocks.audit,
}));
vi.mock("@/lib/agent/organization-store", () => ({
  getOrganizationChart: mocks.getChart,
  upsertOrganizationUnit: mocks.upsertUnit,
  upsertOrganizationSeat: vi.fn(),
  deleteOrganizationUnit: vi.fn(),
  deleteOrganizationSeat: vi.fn(),
  mutateOrganizationFlow: vi.fn(),
  replaceOrganization: mocks.replaceOrg,
}));
vi.mock("@/lib/agent/organization-runtime", () => ({
  organizationRuntime: mocks.orgRuntime,
  resolveOrganizationSeat: mocks.resolveSeat,
}));

import { GET, POST } from "./route";

function makeReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ session: { device_id: "dev-viewer" }, role: "viewer" });
  mocks.rateLimited.mockReturnValue(false);
  mocks.getChart.mockResolvedValue({ name: "Default Org", revision: "rev-1", units: [], seats: [] });
  mocks.upsertUnit.mockResolvedValue({ name: "Default Org", revision: "rev-2" });
  mocks.replaceOrg.mockResolvedValue({ name: "Replaced Org", revision: "rev-3" });
  mocks.orgRuntime.mockResolvedValue([]);
  mocks.resolveSeat.mockResolvedValue({ id: "seat-lead", title: "Lead" });
});

describe("GET /api/v1/organization", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(makeReq("https://mso.example/api/v1/organization"));
    expect(res.status).toBe(401);
    expect(mocks.getChart).not.toHaveBeenCalled();
  });

  it("returns full chart and runtime for viewers", async () => {
    const res = await GET(makeReq("https://mso.example/api/v1/organization"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chart.revision).toBe("rev-1");
    expect(mocks.getChart).toHaveBeenCalled();
  });

  it("resolves specific seat when seat parameter is provided", async () => {
    const res = await GET(makeReq("https://mso.example/api/v1/organization?seat=seat-lead"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seat).toEqual({ id: "seat-lead", title: "Lead" });
    expect(mocks.resolveSeat).toHaveBeenCalledWith("seat-lead");
  });
});

describe("POST /api/v1/organization", () => {
  it("refuses viewer role with operator_required", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-viewer" }, role: "viewer" });
    const res = await POST(
      makeReq("https://mso.example/api/v1/organization", "POST", { action: "unit_upsert" }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "operator_required" });
  });

  it("returns 429 when rate limited", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-op" }, role: "operator" });
    mocks.rateLimited.mockReturnValue(true);
    const res = await POST(
      makeReq("https://mso.example/api/v1/organization", "POST", {
        action: "unit_upsert",
        expected_revision: "rev-1",
        unit: { id: "u1" },
      }),
    );
    expect(res.status).toBe(429);
    expect(mocks.upsertUnit).not.toHaveBeenCalled();
  });

  it("mutates organization and audits for operator", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-op" }, role: "operator" });
    const res = await POST(
      makeReq("https://mso.example/api/v1/organization", "POST", {
        action: "unit_upsert",
        expected_revision: "rev-1",
        unit: { id: "u1", name: "Engineering" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.upsertUnit).toHaveBeenCalledWith("rev-1", { id: "u1", name: "Engineering" });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "agent.organization", target: "unit_upsert" }),
    );
  });

  it("requires owner role for replace action", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-op" }, role: "operator" });
    const res = await POST(
      makeReq("https://mso.example/api/v1/organization", "POST", {
        action: "replace",
        expected_revision: "rev-1",
        chart: {},
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });

    mocks.session.mockResolvedValue({ session: { device_id: "dev-owner" }, role: "owner" });
    const ownerRes = await POST(
      makeReq("https://mso.example/api/v1/organization", "POST", {
        action: "replace",
        expected_revision: "rev-1",
        chart: {},
      }),
    );
    expect(ownerRes.status).toBe(200);
    expect(mocks.replaceOrg).toHaveBeenCalled();
  });
});
