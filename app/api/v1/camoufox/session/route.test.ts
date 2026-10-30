import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  demo: false,
  role: "operator" as string | null,
  deviceId: "test-device" as string | null,
  viewerOrigin: "https://viewer.mso.example.com" as string | null,
  createTicket: vi.fn(() => "ticket-123456"),
  readFile: vi.fn(async () => "vncpassword\n"),
}));

vi.mock("@/lib/demo", () => ({ get IS_DEMO() { return mocks.demo; } }));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () =>
    mocks.deviceId
      ? {
          role: mocks.role,
          session: {
            device_id: mocks.deviceId,
            issued_at: 1700000000000,
            expires_at: 1700003600000,
          },
        }
      : null,
  ),
}));
vi.mock("@/lib/camoufox/origin", () => ({
  camoufoxViewerOrigin: vi.fn(() => mocks.viewerOrigin),
}));
vi.mock("@/lib/camoufox/viewer-auth", () => ({
  createCamoufoxViewerTicket: mocks.createTicket,
}));
vi.mock("node:fs", () => ({
  promises: {
    readFile: mocks.readFile,
  },
}));

import { GET } from "./route";

const ORIGINAL_SECRET = process.env.OS_SESSION_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo = false;
  mocks.role = "operator";
  mocks.deviceId = "test-device";
  mocks.viewerOrigin = "https://viewer.mso.example.com";
  mocks.createTicket.mockReturnValue("ticket-123456");
  mocks.readFile.mockResolvedValue("vncpassword\n");
  process.env.OS_SESSION_SECRET = "a".repeat(32);
});

afterEach(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.OS_SESSION_SECRET = ORIGINAL_SECRET;
  } else {
    delete process.env.OS_SESSION_SECRET;
  }
});

describe("GET /api/v1/camoufox/session", () => {
  it("returns 404 unavailable when running in demo mode", async () => {
    // Demo environment has no host browser or VNC display
    mocks.demo = true;
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("returns 401 Unauthorized when session is missing or unauthenticated", async () => {
    mocks.deviceId = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 Unauthorized when device role is below operator", async () => {
    // Viewer role cannot control or view the host desktop
    mocks.role = "viewer";
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 503 viewer_unconfigured when session signing secret is shorter than 32 chars", async () => {
    process.env.OS_SESSION_SECRET = "too-short-secret";
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "viewer_unconfigured" });
  });

  it("returns 503 viewer_unconfigured when viewer origin is not configured", async () => {
    mocks.viewerOrigin = null;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "viewer_unconfigured" });
  });

  it("returns no_password_file reason when password file is missing or empty", async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      password: null,
      viewerOrigin: "https://viewer.mso.example.com",
      viewerTicket: "ticket-123456",
      viewerPathPrefix: "/_mso-camoufox",
      reason: "no_password_file",
    });
  });

  it("returns password and viewer ticket on happy path for operator", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      password: "vncpassword",
      viewerOrigin: "https://viewer.mso.example.com",
      viewerTicket: "ticket-123456",
      viewerPathPrefix: "/_mso-camoufox",
    });
  });
});
