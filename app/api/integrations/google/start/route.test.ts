import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  beginGoogleAuthorization: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.getSessionContext,
}));
vi.mock("@/lib/infra/google-oauth-flow", () => ({
  beginGoogleAuthorization: mocks.beginGoogleAuthorization,
}));
vi.mock("@/lib/host/audit-api", () => ({
  audit: mocks.audit,
}));

import { POST } from "./route";

const DEFAULT_ORIGIN = "https://mso.example.com";
const DEFAULT_HOST = "mso.example.com";

function makeReq(
  body: unknown,
  options: { origin?: string; host?: string } = {},
): NextRequest {
  return new NextRequest(`${DEFAULT_ORIGIN}/api/integrations/google/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? DEFAULT_ORIGIN,
      host: options.host ?? DEFAULT_HOST,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OS_PUBLIC_ORIGIN = DEFAULT_ORIGIN;
  mocks.getSessionContext.mockResolvedValue({
    role: "owner",
    session: {
      device_id: "dev-owner-123",
      cookie_scope: "scope",
      cookie_epoch: 1,
      issued_at: 1000,
      expires_at: 2000,
    },
  });
  mocks.beginGoogleAuthorization.mockResolvedValue({
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&state=flowstate12345678901234567890123456789012",
    cookieName: "__Host-mso-google-flow",
    binding: "flow-binding-val",
    expiresIn: 600,
  });
});

afterEach(() => {
  delete process.env.OS_PUBLIC_ORIGIN;
});

describe("POST /api/integrations/google/start", () => {
  it("refuses unauthenticated callers with 403 owner_required", async () => {
    // Only authenticated owner sessions may initiate Google OAuth authorization
    mocks.getSessionContext.mockResolvedValue(null);
    const res = await POST(makeReq({ user: "owner", provider: "google-search-console", connection: "primary" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.beginGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("refuses non-owner roles with 403 owner_required", async () => {
    for (const role of ["viewer", "operator"]) {
      mocks.getSessionContext.mockResolvedValue({
        role,
        session: { device_id: "dev-123", cookie_scope: "scope", cookie_epoch: 1, issued_at: 1000, expires_at: 2000 },
      });
      const res = await POST(makeReq({ user: "owner", provider: "google-search-console", connection: "primary" }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "owner_required" });
    }
    expect(mocks.beginGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("rejects mismatched origin or host with 403 google_same_origin_required", async () => {
    const badOrigin = await POST(makeReq({ user: "owner", provider: "google-search-console", connection: "primary" }, { origin: "https://evil.invalid" }));
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toEqual({ error: "google_same_origin_required" });

    const badHost = await POST(makeReq({ user: "owner", provider: "google-search-console", connection: "primary" }, { host: "evil.invalid" }));
    expect(badHost.status).toBe(403);
    expect(await badHost.json()).toEqual({ error: "google_same_origin_required" });
    expect(mocks.beginGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("rejects non-google providers and extraneous fields with 400 invalid_google_request", async () => {
    // Non-Google provider is rejected
    const badProvider = await POST(makeReq({ user: "owner", provider: "github", connection: "primary" }));
    expect(badProvider.status).toBe(400);
    expect(await badProvider.json()).toEqual({ error: "invalid_google_request" });

    // Extraneous parameters are disallowed to prevent metadata smuggling
    const extraField = await POST(makeReq({ user: "owner", provider: "google-search-console", connection: "primary", extra: "forbidden" }));
    expect(extraField.status).toBe(400);
    expect(await extraField.json()).toEqual({ error: "invalid_google_request" });
    expect(mocks.beginGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("starts flow on happy path, returning an authorizationUrl with state param and binding cookie", async () => {
    const res = await POST(makeReq({ user: "owner", provider: "google-search-console", connection: "primary" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.expiresIn).toBe(600);
    expect(body.authorizationUrl).toBeDefined();

    // Verify the returned URL carries the state parameter required for OAuth CSRF protection
    const parsedUrl = new URL(body.authorizationUrl);
    expect(parsedUrl.searchParams.has("state")).toBe(true);
    expect(parsedUrl.searchParams.get("state")).toBe("flowstate12345678901234567890123456789012");

    // Flow binding cookie must be set on the response
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("__Host-mso-google-flow=flow-binding-val");
    expect(setCookie).toContain("HttpOnly");

    // Action must be audited
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "infra.write",
        actor: "dev-owner-123",
        target: "owner/google-search-console/primary",
        ok: true,
        detail: "google.authorization.start",
      }),
    );
  });
});
