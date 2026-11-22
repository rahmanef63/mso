import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async () => true),
  listProviderSummaries: vi.fn(async () => [
    { id: "mock-prov", name: "Mock Provider", connected: true },
  ]),
  providerSummariesFromCatalog: vi.fn(() => [
    { id: "offline-prov", name: "Offline Provider", connected: false },
  ]),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));

vi.mock("@/lib/models/discovery.js", () => ({
  listProviderSummaries: mocks.listProviderSummaries,
  providerSummariesFromCatalog: mocks.providerSummariesFromCatalog,
}));

import { GET } from "./route";

const getReq = (url = "https://mso.example/api/models/providers") =>
  new NextRequest(url, { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(true);
  mocks.listProviderSummaries.mockResolvedValue([
    { id: "mock-prov", name: "Mock Provider", connected: true },
  ]);
  mocks.providerSummariesFromCatalog.mockReturnValue([
    { id: "offline-prov", name: "Offline Provider", connected: false },
  ]);
});

describe("GET /api/models/providers", () => {
  it("returns 401 when requireSession('owner') rejects caller", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.requireSession).toHaveBeenCalledWith("owner");
    expect(mocks.listProviderSummaries).not.toHaveBeenCalled();
  });

  it("returns provider summaries with freeOnly=false by default", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providers: [{ id: "mock-prov", name: "Mock Provider", connected: true }],
    });
    expect(mocks.listProviderSummaries).toHaveBeenCalledWith({ freeOnly: false });
  });

  it("passes freeOnly=true when ?free=1 query parameter is given", async () => {
    const res = await GET(getReq("https://mso.example/api/models/providers?free=1"));
    expect(res.status).toBe(200);
    expect(mocks.listProviderSummaries).toHaveBeenCalledWith({ freeOnly: true });
  });

  it("falls back to providerSummariesFromCatalog when discovery throws (offline box)", async () => {
    mocks.listProviderSummaries.mockRejectedValue(new Error("Network unreachable"));
    const res = await GET(getReq("https://mso.example/api/models/providers?free=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providers: [{ id: "offline-prov", name: "Offline Provider", connected: false }],
    });
    expect(mocks.providerSummariesFromCatalog).toHaveBeenCalledWith({}, { freeOnly: true });
  });
});
