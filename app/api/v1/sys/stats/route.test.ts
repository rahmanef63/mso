import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const defaultStats = {
  cpu: { pct: 12, cores: 4 },
  mem: { used: 2048, total: 8192 },
  disk: { used: 40000, total: 100000 },
  net: { rx: 0, tx: 0 },
  uptime: 123456,
};

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  stats: vi.fn(async () => defaultStats),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/system-api", () => ({ stats: mocks.stats }));

import { GET } from "./route";

function makeReq(): Request {
  return new Request("https://mso.example.com/api/v1/sys/stats");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.stats.mockResolvedValue(defaultStats);
});

describe("GET /api/v1/sys/stats", () => {
  it("returns 401 when unauthenticated and does not call stats", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it("returns system stats on happy path", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(defaultStats);
    expect(mocks.stats).toHaveBeenCalledOnce();
  });

  it("translates HostError through apiError with custom status and message", async () => {
    // Specific host telemetry failure handled cleanly without crashing
    mocks.stats.mockRejectedValue(new HostError("Telemetry unavailable", 503));
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Telemetry unavailable" });
  });

  it("translates unexpected exceptions to generic 500 error via apiError", async () => {
    // Unexpected internal exceptions return sanitized generic error
    mocks.stats.mockRejectedValue(new Error("proc stat read failed"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Operation failed" });
  });
});
