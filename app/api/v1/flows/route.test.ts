import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  flowCatalog: vi.fn(async () => ({ project: { id: "p1" }, flows: [], revision: "rev-1" })),
  flowStatus: vi.fn(async () => ({ run_id: "run-1", status: "completed" })),
  createSession: vi.fn(async () => ({ id: "sess-1" })),
  executeCapability: vi.fn(async (): Promise<Record<string, unknown>> => ({ kind: "success", result: { ok: true, run_id: "run-1" } })),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.session,
}));
vi.mock("@/lib/workflow/automation-catalog", () => ({
  flowCatalog: mocks.flowCatalog,
}));
vi.mock("@/lib/workflow/automation-engine", () => ({
  flowStatus: mocks.flowStatus,
}));
vi.mock("@/lib/agent/session-store", () => ({
  createAgentSession: mocks.createSession,
}));
vi.mock("@/lib/capabilities/execute", () => ({
  executeCapabilityCall: mocks.executeCapability,
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
  mocks.session.mockResolvedValue({ session: { device_id: "dev-owner" }, role: "owner" });
  mocks.flowCatalog.mockResolvedValue({ project: { id: "p1" }, flows: [], revision: "rev-1" });
  mocks.flowStatus.mockResolvedValue({ run_id: "run-1", status: "completed" });
  mocks.createSession.mockResolvedValue({ id: "sess-1" });
  mocks.executeCapability.mockResolvedValue({ kind: "success", result: { ok: true, run_id: "run-1" } });
});

describe("GET /api/v1/flows", () => {
  it("refuses unauthenticated callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(makeReq("https://mso.example/api/v1/flows"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.flowCatalog).not.toHaveBeenCalled();
  });

  it.each(["viewer", "operator"])("refuses %s role with owner_required", async (role) => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-sub" }, role });
    const res = await GET(makeReq("https://mso.example/api/v1/flows"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
  });

  it("returns catalog when no run_id query is present", async () => {
    const res = await GET(makeReq("https://mso.example/api/v1/flows?project=p1&flow=deploy"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ project: "p1", flows: [], revision: "rev-1" });
    expect(mocks.flowCatalog).toHaveBeenCalledWith("p1", "deploy");
  });

  it("returns flow status when run_id is supplied", async () => {
    const res = await GET(makeReq("https://mso.example/api/v1/flows?run_id=run-1&wait_ms=100"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run_id: "run-1", status: "completed" });
    expect(mocks.flowStatus).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ principal: "cli:dev-owner" }),
      100,
    );
  });
});

describe("POST /api/v1/flows", () => {
  it("refuses unauthenticated callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await POST(makeReq("https://mso.example/api/v1/flows", "POST", { action: "run" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("executes automation run action", async () => {
    const res = await POST(
      makeReq("https://mso.example/api/v1/flows", "POST", { action: "run", flow: "backup" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, run_id: "run-1" });
    expect(mocks.createSession).toHaveBeenCalledWith("cli:dev-owner", "cli", {
      title: "Automation: backup",
      titleSource: "auto",
    });
    expect(mocks.executeCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "cli:dev-owner",
        args: { flow: "backup" },
      }),
    );
  });

  it("returns 400 when unknown action is requested", async () => {
    const res = await POST(
      makeReq("https://mso.example/api/v1/flows", "POST", { action: "unknown_act" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown flow action" });
    expect(mocks.executeCapability).not.toHaveBeenCalled();
  });

  it("returns 400 when execution fails", async () => {
    mocks.executeCapability.mockResolvedValue({ kind: "error", message: "flow step failed" });
    const res = await POST(
      makeReq("https://mso.example/api/v1/flows", "POST", { action: "run" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "flow step failed" });
  });
});
