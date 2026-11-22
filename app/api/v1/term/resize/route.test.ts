import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "test-device" as string | null),
  resizePty: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/terminal-api", () => ({
  openPty: vi.fn(),
  closePty: vi.fn(),
  writePty: vi.fn(),
  resizePty: mocks.resizePty,
}));

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("https://mso.example/api/v1/term/resize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.actor.mockResolvedValue("test-device");
  mocks.resizePty.mockReturnValue(undefined);
});

describe("POST /api/v1/term/resize", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await POST(makeReq({ id: "term-1", cols: 100, rows: 30 }));
    expect(res.status).toBe(401);
    expect(mocks.resizePty).not.toHaveBeenCalled();
  });

  it("refuses requests when session actor is missing", async () => {
    mocks.actor.mockResolvedValue(null);
    const res = await POST(makeReq({ id: "term-1", cols: 100, rows: 30 }));
    expect(res.status).toBe(401);
    expect(mocks.resizePty).not.toHaveBeenCalled();
  });

  it("validates id, cols, and rows", async () => {
    expect((await POST(makeReq({ cols: 100, rows: 30 }))).status).toBe(400);
    expect((await POST(makeReq({ id: "term-1", cols: 1, rows: 30 }))).status).toBe(400);
    expect((await POST(makeReq({ id: "term-1", cols: 100, rows: 600 }))).status).toBe(400);
    expect(mocks.resizePty).not.toHaveBeenCalled();
  });

  it("calls resizePty with validated dimensions", async () => {
    const res = await POST(makeReq({ id: "term-1", cols: 120, rows: 40 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.resizePty).toHaveBeenCalledWith("term-1", "test-device", 120, 40);
  });

  it("returns error status when resizePty throws", async () => {
    mocks.resizePty.mockImplementation(() => {
      throw new Error("PTY not found");
    });
    const res = await POST(makeReq({ id: "term-1", cols: 100, rows: 30 }));
    expect(res.status).toBe(500);
  });
});
