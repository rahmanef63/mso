import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = { role: "owner" as "viewer" | "operator" | "owner" | null };
const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => ({ name: "Owner", icon: { type: "preset", id: "user" } })),
  write: vi.fn(async () => ({ name: "Rahman", icon: { type: "preset", id: "star" } })),
  audit: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => session.role ? ({
    session: { device_id: "b".repeat(32), issued_at: 1, expires_at: 2, cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" },
    device: { label: "current", approvedAt: 1, role: session.role },
    role: session.role,
  }) : null),
}));
vi.mock("@/lib/auth/account-profile", () => ({
  readAccountProfile: mocks.read,
  writeAccountProfile: mocks.write,
  AccountProfileError: class AccountProfileError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));

const post = (body: unknown) => new NextRequest("https://mso.example/api/auth/account", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  session.role = "owner";
  mocks.read.mockClear();
  mocks.write.mockClear();
  mocks.audit.mockClear();
});

describe("account profile route", () => {
  it("lets any signed-in device read the display profile and only an owner change it", async () => {
    const { GET, POST } = await import("./route");
    session.role = "viewer";
    expect((await GET()).status).toBe(200);
    expect((await POST(post({ name: "Rahman" }))).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
    session.role = null;
    expect((await GET()).status).toBe(401);
  });

  it("saves a name or icon and audits the field, not the image bytes", async () => {
    const { POST } = await import("./route");
    const secret = "data:image/png;base64,SECRETPIXELS";
    expect((await POST(post({ icon: { type: "image", src: secret } }))).status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith({ name: undefined, icon: { type: "image", src: secret } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.account", detail: "icon" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("SECRETPIXELS");
  });

  it("rejects an empty change", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({}))).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
