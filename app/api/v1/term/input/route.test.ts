import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "test-device" as string | null),
  writePty: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/terminal-api", () => ({
  openPty: vi.fn(),
  closePty: vi.fn(),
  writePty: mocks.writePty,
  resizePty: vi.fn(),
}));

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("https://mso.example/api/v1/term/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.actor.mockResolvedValue("test-device");
  mocks.writePty.mockReturnValue(undefined);
});

describe("POST /api/v1/term/input", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await POST(makeReq({ id: "term-1", data: "ls\n" }));
    expect(res.status).toBe(401);
    expect(mocks.writePty).not.toHaveBeenCalled();
  });

  it("refuses requests when session actor is missing", async () => {
    mocks.actor.mockResolvedValue(null);
    const res = await POST(makeReq({ id: "term-1", data: "ls\n" }));
    expect(res.status).toBe(401);
    expect(mocks.writePty).not.toHaveBeenCalled();
  });

  it("validates required id and data fields", async () => {
    expect((await POST(makeReq({ data: "ls\n" }))).status).toBe(400);
    expect((await POST(makeReq({ id: "" }))).status).toBe(400);
    expect((await POST(makeReq({ id: "term-1" }))).status).toBe(400);
    expect(mocks.writePty).not.toHaveBeenCalled();
  });

  it("passes keystrokes to writePty", async () => {
    const res = await POST(makeReq({ id: "term-1", data: "echo hi\n" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.writePty).toHaveBeenCalledWith("term-1", "test-device", "echo hi\n");
  });

  it("allows empty data string", async () => {
    const res = await POST(makeReq({ id: "term-1", data: "" }));
    expect(res.status).toBe(200);
    expect(mocks.writePty).toHaveBeenCalledWith("term-1", "test-device", "");
  });

  it("returns error status when writePty throws", async () => {
    mocks.writePty.mockImplementation(() => {
      throw new Error("PTY not found");
    });
    const res = await POST(makeReq({ id: "term-1", data: "hi" }));
    expect(res.status).toBe(500);
  });
});
