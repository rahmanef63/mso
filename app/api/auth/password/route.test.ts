import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LoginPasswordError } from "@/lib/auth/login-password";

const session = { role: "owner" as "viewer" | "owner" | null };
const mocks = vi.hoisted(() => ({
  rotate: vi.fn(async () => {}),
  audit: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => session.role ? ({
    session: { device_id: "b".repeat(32), issued_at: 1, expires_at: 2, cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" },
    device: { label: "current", approvedAt: 1, role: session.role },
    role: session.role,
  }) : null),
}));
vi.mock("@/lib/auth/login-password", () => ({
  rotateLoginPassword: mocks.rotate,
  LoginPasswordError: class LoginPasswordError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));

const post = (body: unknown) => new NextRequest("https://mso.example/api/auth/password", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  session.role = "owner";
  mocks.rotate.mockReset().mockResolvedValue(undefined);
  mocks.audit.mockClear();
});

describe("password rotation route", () => {
  it("requires an owner and never audits the submitted passwords", async () => {
    const { POST } = await import("./route");
    session.role = "viewer";
    expect((await POST(post({ currentPassword: "current-pass", newPassword: "next-pass-1", confirmPassword: "next-pass-1" }))).status).toBe(403);
    expect(mocks.rotate).not.toHaveBeenCalled();
    session.role = "owner";
    expect((await POST(post({ currentPassword: "current-pass", newPassword: "next-pass-1", confirmPassword: "next-pass-1" }))).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.password", ok: true, detail: "rotated" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("current-pass");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("next-pass-1");
  });

  it("maps a wrong current password to 401 without writing an audit secret", async () => {
    mocks.rotate.mockRejectedValue(new LoginPasswordError("bad_current"));
    const { POST } = await import("./route");
    const response = await POST(post({ currentPassword: "wrong-pass", newPassword: "next-pass-1", confirmPassword: "next-pass-1" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "bad_current" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("wrong-pass");
  });
});
