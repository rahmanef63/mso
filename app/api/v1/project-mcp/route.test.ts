import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  demo: false,
  execute: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.session,
}));

vi.mock("@/lib/demo", () => ({
  get IS_DEMO() {
    return mocks.demo;
  },
}));

vi.mock("@/lib/capabilities/execute", () => ({
  executeCapabilityCall: mocks.execute,
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("https://mso.example/api/v1/project-mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo = false;
  mocks.session.mockResolvedValue({ session: { device_id: "dev-owner" }, role: "owner" });
  mocks.execute.mockResolvedValue({ kind: "success", result: { ok: true, servers: [] } });
});

describe("POST /api/v1/project-mcp", () => {
  it("refuses unauthenticated callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await POST(makeReq({ action: "tools" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["viewer", "operator"])("refuses %s role", async (role) => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-sub" }, role });
    const res = await POST(makeReq({ action: "tools" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("refuses when IS_DEMO is true even for owner", async () => {
    mocks.demo = true;
    const res = await POST(makeReq({ action: "tools" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("executes project tools action successfully", async () => {
    const res = await POST(makeReq({ action: "tools", server: "sqlite" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, servers: [] });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "device:dev-owner",
        args: { server: "sqlite" },
      }),
    );
  });

  it("returns 400 when capability execution reports failure", async () => {
    mocks.execute.mockResolvedValue({ kind: "error", message: "server not found" });
    const res = await POST(makeReq({ action: "manage" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "server not found" });
  });
});
