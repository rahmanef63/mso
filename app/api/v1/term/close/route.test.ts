import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "test-device" as string | null),
  audit: vi.fn(),
  closePty: vi.fn(() => true),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/terminal-api", () => ({
  openPty: vi.fn(),
  closePty: mocks.closePty,
  writePty: vi.fn(),
  resizePty: vi.fn(),
}));

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("https://mso.example/api/v1/term/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.actor.mockResolvedValue("test-device");
  mocks.closePty.mockReturnValue(true);
});

describe("POST /api/v1/term/close", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await POST(makeReq({ id: "term-12345678" }));
    expect(res.status).toBe(401);
    expect(mocks.closePty).not.toHaveBeenCalled();
  });

  it("refuses requests when session actor is missing", async () => {
    mocks.actor.mockResolvedValue(null);
    const res = await POST(makeReq({ id: "term-12345678" }));
    expect(res.status).toBe(401);
    expect(mocks.closePty).not.toHaveBeenCalled();
  });

  it("validates required id parameter", async () => {
    expect((await POST(makeReq({}))).status).toBe(400);
    expect((await POST(makeReq({ id: "" }))).status).toBe(400);
    expect(mocks.closePty).not.toHaveBeenCalled();
  });

  it("kills pty and audits when pty was active", async () => {
    mocks.closePty.mockReturnValue(true);
    const res = await POST(makeReq({ id: "term-12345678" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.closePty).toHaveBeenCalledWith("term-12345678", "test-device");
    expect(mocks.audit).toHaveBeenCalledWith({
      action: "term.close",
      actor: "test-device",
      target: "pty term-123",
      ok: true,
    });
  });

  it("does not audit if closePty returned false (already closed)", async () => {
    mocks.closePty.mockReturnValue(false);
    const res = await POST(makeReq({ id: "term-12345678" }));
    expect(res.status).toBe(200);
    expect(mocks.closePty).toHaveBeenCalledWith("term-12345678", "test-device");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns error status when closePty throws", async () => {
    mocks.closePty.mockImplementation(() => {
      throw new Error("close failed");
    });
    const res = await POST(makeReq({ id: "term-12345678" }));
    expect(res.status).toBe(500);
  });
});
