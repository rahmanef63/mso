import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "test-device"),
  rateLimited: vi.fn(() => false),
  audit: vi.fn(),
  openPty: vi.fn(async () => ({ id: "pty-12345678", cwd: "/tmp" })),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/terminal-api", () => ({
  openPty: mocks.openPty,
  closePty: vi.fn(),
  writePty: vi.fn(),
  resizePty: vi.fn(),
}));

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("https://mso.example/api/v1/term/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.actor.mockResolvedValue("test-device");
  mocks.rateLimited.mockReturnValue(false);
  mocks.openPty.mockResolvedValue({ id: "pty-12345678", cwd: "/tmp" });
});

describe("POST /api/v1/term/open", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await POST(makeReq({ cols: 80, rows: 24 }));
    expect(res.status).toBe(401);
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("returns 429 and audits when rate limited", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await POST(makeReq({ cols: 80, rows: 24 }));
    expect(res.status).toBe(429);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "term.open", ok: false, detail: "rate-limited" }),
    );
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("validates cols and rows boundaries", async () => {
    expect((await POST(makeReq({ cols: 1, rows: 24 }))).status).toBe(400);
    expect((await POST(makeReq({ cols: 80, rows: 501 }))).status).toBe(400);
    expect((await POST(makeReq({ cols: "bad", rows: 24 }))).status).toBe(400);
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("spawns pty and audits success on valid request", async () => {
    const res = await POST(makeReq({ cols: 120, rows: 40, cwd: "/home/user" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "pty-12345678" });
    expect(mocks.openPty).toHaveBeenCalledWith({
      cols: 120,
      rows: 40,
      cwd: "/home/user",
      owner: "test-device",
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "term.open", ok: true, target: "/tmp" }),
    );
  });

  it("audits failure and returns error when openPty throws", async () => {
    mocks.openPty.mockRejectedValue(new Error("pty spawn failed"));
    const res = await POST(makeReq({ cols: 80, rows: 24 }));
    expect(res.status).toBe(500);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "term.open", ok: false }),
    );
  });
});
