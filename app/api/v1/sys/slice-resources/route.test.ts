import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  session: vi.fn(async (): Promise<{ role: string; session: { device_id: string } } | null> => ({
    role: "owner",
    session: { device_id: "owner-device" },
  })),
  knownSlices: vi.fn(() => ["system-monitor", "docs", "brand-new-slice"]),
  buckets: vi.fn(() => [
    { slice: "system-monitor", calls: 10, wallMs: 500, cpuMs: 4_000, peakConcurrency: 2, resultBytes: 1_000, unmeasuredResults: 0, firstAt: 1_000, lastAt: 30_000 },
  ]),
  dropped: vi.fn(() => 0),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/resources/slices", () => ({ knownSliceDirectories: mocks.knownSlices }));
vi.mock("@/lib/resources/ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resources/ledger")>()),
  aggregateSliceUsage: () => ({ buckets: mocks.buckets(), dropped: mocks.dropped() }),
}));

import { GET } from "./route";

const req = () => new Request("https://mso.example.com/api/v1/sys/slice-resources");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.session.mockResolvedValue({ role: "owner", session: { device_id: "owner-device" } });
  mocks.knownSlices.mockReturnValue(["system-monitor", "docs", "brand-new-slice"]);
  mocks.buckets.mockReturnValue([
    { slice: "system-monitor", calls: 10, wallMs: 500, cpuMs: 4_000, peakConcurrency: 2, resultBytes: 1_000, unmeasuredResults: 0, firstAt: 1_000, lastAt: 30_000 },
  ]);
  mocks.dropped.mockReturnValue(0);
});

describe("GET /api/v1/sys/slice-resources", () => {
  it("returns 401 when unauthenticated and never reads the ledger", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.buckets).not.toHaveBeenCalled();
  });

  it("refuses a non-owner device with 403, because the report is installation cost", async () => {
    mocks.session.mockResolvedValue({ role: "viewer", session: { device_id: "viewer-device" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.buckets).not.toHaveBeenCalled();
  });

  it("serves the per-slice budget vs actual report to owner", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.slices.map((row: { slice: string }) => row.slice)).toEqual(["docs", "system-monitor"]);
    expect(body.unaccountedSlices).toEqual(["brand-new-slice"]);
    expect(body.bufferCapacity).toBe(2048);
  });

  it("states the installation scope instead of implying per-org isolation", async () => {
    const body = await (await GET(req())).json();
    expect(body.scope.kind).toBe("installation");
    expect(body.scope.detail).toMatch(/no per-organization or per-tenant resource accounting/i);
  });

  it("reports its own measured-coverage limit rather than implying full instrumentation", async () => {
    const body = await (await GET(req())).json();
    // slicesOnDisk counts everything the directory read returned; registered counts
    // slices with a budget entry; instrumented counts slices whose capability calls
    // actually record samples. These must never be conflated into one number.
    expect(body.coverage.slicesOnDisk).toBe(3);
    expect(body.coverage.registered).toBe(2);
    // Instrumentation is a property of the attribution map, not of the mocked
    // directory, so it is asserted as present and separate from `registered`.
    expect(body.coverage.instrumented).toBeGreaterThan(0);
    expect(body.coverage.documentedOnly).toEqual(["memory-graph", "n8n", "os-terminal", "system-monitor"]);
    expect(body.coverage.detail).toMatch(/Measurement is partial/i);
  });

  it("reports enforcement off by default", async () => {
    const body = await (await GET(req())).json();
    expect(body.enforcement.enabled).toBe(false);
    expect(body.enforcement.setting).toBe("OS_SLICE_RESOURCE_ENFORCEMENT");
    expect(body.enforcement.applies_to).toBe("concurrent-tasks only");
  });

  it("reports enforcement on only for the explicit opt-in value", async () => {
    vi.stubEnv("OS_SLICE_RESOURCE_ENFORCEMENT", "1");
    const body = await (await GET(req())).json();
    expect(body.enforcement.enabled).toBe(true);
  });

  it("keeps enforcement off for a truthy-looking value an operator might write", async () => {
    vi.stubEnv("OS_SLICE_RESOURCE_ENFORCEMENT", "false");
    const body = await (await GET(req())).json();
    expect(body.enforcement.enabled).toBe(false);
  });
});
