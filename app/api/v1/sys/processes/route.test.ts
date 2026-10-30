import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  processes: vi.fn(async () => [
    { pid: 1234, name: "node", cpu: 1.5, mem: 45, status: "R" },
  ]),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/system-api", () => ({ processes: mocks.processes }));

import { GET } from "./route";

function makeReq(): Request {
  return new Request("https://mso.example.com/api/v1/sys/processes");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.processes.mockResolvedValue([
    { pid: 1234, name: "node", cpu: 1.5, mem: 45, status: "R" },
  ]);
});

describe("GET /api/v1/sys/processes", () => {
  it("returns 401 when unauthenticated and does not call processes", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.processes).not.toHaveBeenCalled();
  });

  it("returns process list on happy path", async () => {
    const sample = [
      { pid: 42, name: "mso", cpu: 0.8, mem: 64, status: "S" },
    ];
    mocks.processes.mockResolvedValue(sample);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sample);
    expect(mocks.processes).toHaveBeenCalledOnce();
  });

  it("translates HostError through apiError with custom status and message", async () => {
    // Curated HostError messages pass through with explicit status and message
    mocks.processes.mockRejectedValue(new HostError("Process table unavailable", 503));
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Process table unavailable" });
  });

  it("translates unexpected exceptions to generic 500 error via apiError", async () => {
    // Raw exceptions must be masked to avoid leaking internal system details
    mocks.processes.mockRejectedValue(new Error("ps command failed unexpectedly"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Operation failed" });
  });
});
