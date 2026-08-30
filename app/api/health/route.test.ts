// Liveness probe contract: 200 + required shape + no-store. The endpoint
// is unauthenticated by design — external monitors need to hit it without
// session credentials.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("/api/health", () => {
  it("returns 200 with status/buildId/uptime/version", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.buildId).toBe("string");
    expect(typeof body.uptime).toBe("number");
    expect((body.uptime as number) >= 0).toBe(true);
    expect(typeof body.version).toBe("string");
    expect((body.version as string).length).toBeGreaterThan(0);
  });

  it("returns the runtime instance id supplied by the service manager", async () => {
    vi.stubEnv("MSO_RUNTIME_INSTANCE_ID", "restart-proof-123");
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.runtimeInstanceId).toBe("restart-proof-123");
  });

  it("sets Cache-Control: no-store", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not expose host uptime in demo builds", async () => {
    vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "1");
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.demo).toBe(true);
    expect(body.uptime).toBeUndefined();
  });
});
