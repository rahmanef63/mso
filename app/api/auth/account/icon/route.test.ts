import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = { role: "owner" as "viewer" | "operator" | "owner" | null };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => ({ name: "Owner", icon: { type: "preset", id: "user" } })),
  write: vi.fn(async () => ({ name: "Owner", icon: { type: "image", src: "data:image/webp;base64,AAAA" } })),
  audit: vi.fn(async () => {}),
  convert: vi.fn(async () => ({ webp: Buffer.from("WEBPBYTES"), png192: Buffer.alloc(0), png512: Buffer.alloc(0), apple180: Buffer.alloc(0), ico: Buffer.alloc(0) })),
  iconPng: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => state.role ? ({
    session: { device_id: "b".repeat(32), issued_at: 1, expires_at: 2, cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" },
    device: { label: "current", approvedAt: 1, role: state.role },
    role: state.role,
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
vi.mock("@/lib/auth/account-icon-image", async (importOriginal) => {
  const original = await importOriginal() as typeof import("@/lib/auth/account-icon-image");
  return {
    ...original,
    convertAccountIcon: mocks.convert,
    accountIconPng: mocks.iconPng,
  };
});
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));

const post = (body: Buffer | string, type = "image/png") => new NextRequest("https://mso.example/api/auth/account/icon", {
  method: "POST",
  headers: { "content-type": type },
  body: typeof body === "string" ? body : new Uint8Array(body),
});

beforeEach(() => {
  state.role = "owner";
  for (const fn of Object.values(mocks)) fn.mockClear();
});

describe("account icon route", () => {
  it("lets only an owner upload, and stores the converted WebP, not the upload", async () => {
    const { POST } = await import("./route");
    state.role = "viewer";
    expect((await POST(post(png))).status).toBe(403);
    state.role = null;
    expect((await POST(post(png))).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();

    state.role = "owner";
    const response = await POST(post(png));
    expect(response.status).toBe(200);
    expect(mocks.convert).toHaveBeenCalledWith(png, "image/png");
    expect(mocks.write).toHaveBeenCalledWith({ icon: { type: "image", src: `data:image/webp;base64,${Buffer.from("WEBPBYTES").toString("base64")}` } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.account", detail: "icon:upload" }));
    // The audit trail must never carry the image bytes.
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(Buffer.from("WEBPBYTES").toString("base64"));
  });

  it("rejects a body over the 8 MiB cap by counting bytes, not by trusting content-length", async () => {
    const { POST } = await import("./route");
    const { MAX_INPUT_BYTES } = await import("@/lib/auth/account-icon-image");
    const oversized = Buffer.alloc(MAX_INPUT_BYTES + 16);
    // No content-length header is set by NextRequest for this stream, so only the
    // reader loop can catch it.
    const response = await POST(post(oversized));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("maps conversion failures to a status the client can explain", async () => {
    const { POST } = await import("./route");
    const { AccountIconError } = await import("@/lib/auth/account-icon-image");
    mocks.convert.mockRejectedValueOnce(new AccountIconError("unsupported_type"));
    expect((await POST(post(png, "text/plain"))).status).toBe(415);
    mocks.convert.mockRejectedValueOnce(new AccountIconError("too_many_pixels"));
    expect((await POST(post(png))).status).toBe(422);
    mocks.convert.mockRejectedValueOnce(new Error("unexpected"));
    expect((await POST(post(png))).status).toBe(400);
  });

  it("serves the stored icon publicly, without a session, and 404s for the demo", async () => {
    const { GET } = await import("./route");
    state.role = null;
    const response = await GET(new NextRequest("https://mso.example/api/auth/account/icon?size=192"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(mocks.read).toHaveBeenCalled();

    mocks.read.mockRejectedValueOnce(new Error("corrupt"));
    expect((await GET(new NextRequest("https://mso.example/api/auth/account/icon"))).status).toBe(404);
  });
});
