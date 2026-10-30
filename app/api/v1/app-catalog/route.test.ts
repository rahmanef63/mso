import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  loadAppCatalog: vi.fn(async (): Promise<{ apps: unknown[] }> => ({ apps: [] })),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.getSessionContext,
}));

vi.mock("@/lib/host/app-catalog", () => ({
  loadAppCatalog: mocks.loadAppCatalog,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionContext.mockResolvedValue({
    role: "owner",
    session: { device_id: "dev-owner-1" },
  });
  mocks.loadAppCatalog.mockResolvedValue({ apps: [{ id: "terminal", name: "Terminal" }] });
});

describe("GET /api/v1/app-catalog", () => {
  // app-catalog uses requireOwner which delegates to getSessionContext:
  // missing session returns 401 { error: "unauthorized" }
  it("returns 401 { error: 'unauthorized' } when session is missing and does not load catalog", async () => {
    mocks.getSessionContext.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.loadAppCatalog).not.toHaveBeenCalled();
  });

  // non-owner role returns 403 { error: "owner_required" }
  it("returns 403 { error: 'owner_required' } when caller role is not owner", async () => {
    mocks.getSessionContext.mockResolvedValue({
      role: "viewer",
      session: { device_id: "dev-viewer-1" },
    });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.loadAppCatalog).not.toHaveBeenCalled();
  });

  it("returns 200 with catalog data when caller is owner", async () => {
    const catalogData = { apps: [{ id: "app-1", title: "App One" }] };
    mocks.loadAppCatalog.mockResolvedValue(catalogData);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(catalogData);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.loadAppCatalog).toHaveBeenCalledTimes(1);
  });
});
