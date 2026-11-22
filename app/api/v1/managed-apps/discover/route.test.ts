import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: vi.fn() }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: vi.fn(() => false) }));
vi.mock("@/lib/managed-apps/local-discovery", () => ({ discoverLocalApps: vi.fn() }));

import { getSessionContext } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { discoverLocalApps } from "@/lib/managed-apps/local-discovery";
import { GET } from "./route";

describe("GET /api/v1/managed-apps/discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimited).mockReturnValue(false);
  });

  it("rejects unauthenticated and non-owner callers", async () => {
    vi.mocked(getSessionContext).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);

    vi.mocked(getSessionContext).mockResolvedValue({ session: { device_id: "dev-op" }, role: "operator" } as never);
    expect((await GET()).status).toBe(403);
  });

  it("returns local discovery snapshot for owner", async () => {
    vi.mocked(getSessionContext).mockResolvedValue({ session: { device_id: "dev-own" }, role: "owner" } as never);
    vi.mocked(discoverLocalApps).mockResolvedValue({
      schemaVersion: 1,
      checkedAt: "2026-11-21T00:00:00.000Z",
      dockerAvailable: true,
      apps: [],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schemaVersion: 1, dockerAvailable: true });
  });
});
