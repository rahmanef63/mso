import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  completeGoogleAuthorization: vi.fn(),
  googleFlowCookie: vi.fn((state: string) => `__Host-mso-google-${state.slice(0, 16)}`),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/infra/google-oauth-flow", () => ({
  completeGoogleAuthorization: mocks.completeGoogleAuthorization,
  googleFlowCookie: mocks.googleFlowCookie,
}));

import { GET } from "./route";

const DEFAULT_ORIGIN = "https://mso.example.com";
const DEFAULT_HOST = "mso.example.com";
const VALID_STATE = "a".repeat(43);

function makeReq(
  search: string,
  options: { host?: string; cookies?: string } = {},
): NextRequest {
  const url = `${DEFAULT_ORIGIN}/api/integrations/google/callback${search}`;
  const headers: Record<string, string> = {
    host: options.host ?? DEFAULT_HOST,
  };
  if (options.cookies) {
    headers.cookie = options.cookies;
  }
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OS_PUBLIC_ORIGIN = DEFAULT_ORIGIN;
  mocks.completeGoogleAuthorization.mockResolvedValue({
    user: "owner",
    provider: "google-search-console",
    connection: "primary",
    status: "authorized",
    verificationRequired: true,
  });
});

afterEach(() => {
  delete process.env.OS_PUBLIC_ORIGIN;
});

describe("GET /api/integrations/google/callback", () => {
  it("rejects request with 409 when public https origin is unconfigured", async () => {
    delete process.env.OS_PUBLIC_ORIGIN;
    const res = await GET(makeReq(`?state=${VALID_STATE}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "google_public_https_origin_required" });
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("rejects mismatched host with 400 invalid_google_callback", async () => {
    // Validates host binding against configured origin to prevent DNS rebinding / host spoofing
    const res = await GET(makeReq(`?state=${VALID_STATE}`, { host: "evil.attacker.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_google_callback" });
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("redirects to retry when state parameter is malformed", async () => {
    // State must be exact 43-character base64url string
    for (const badState of ["short", "bad!char@" + "x".repeat(34), "x".repeat(44), ""]) {
      const res = await GET(makeReq(`?state=${encodeURIComponent(badState)}`));
      expect(res.status).toBe(303);
      const location = res.headers.get("location");
      expect(location).toBe(`${DEFAULT_ORIGIN}/integrations?google=retry`);
    }
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("redirects to retry when duplicate parameters or conflicting code/error are received", async () => {
    // Duplicate state parameter
    const dupState = await GET(makeReq(`?state=${VALID_STATE}&state=${VALID_STATE}`));
    expect(dupState.status).toBe(303);
    expect(dupState.headers.get("location")).toBe(`${DEFAULT_ORIGIN}/integrations?google=retry`);

    // Conflicting code and error
    const conflict = await GET(makeReq(`?state=${VALID_STATE}&code=somecode&error=access_denied`));
    expect(conflict.status).toBe(303);
    expect(conflict.headers.get("location")).toBe(`${DEFAULT_ORIGIN}/integrations?google=retry`);

    // Invalid issuer
    const badIss = await GET(makeReq(`?state=${VALID_STATE}&code=somecode&iss=https://evil.google.fake`));
    expect(badIss.status).toBe(303);
    expect(badIss.headers.get("location")).toBe(`${DEFAULT_ORIGIN}/integrations?google=retry`);
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();
  });

  it("redirects to retry when binding cookie is missing or completeGoogleAuthorization fails", async () => {
    // No cookie provided
    const noCookie = await GET(makeReq(`?state=${VALID_STATE}&code=somecode`));
    expect(noCookie.status).toBe(303);
    expect(noCookie.headers.get("location")).toBe(`${DEFAULT_ORIGIN}/integrations?google=retry`);
    expect(mocks.completeGoogleAuthorization).not.toHaveBeenCalled();

    // Authorization flow completion throws
    const cookieName = mocks.googleFlowCookie(VALID_STATE);
    mocks.completeGoogleAuthorization.mockRejectedValue(new Error("expired"));
    const failedAuth = await GET(makeReq(`?state=${VALID_STATE}&code=somecode`, { cookies: `${cookieName}=binding123` }));
    expect(failedAuth.status).toBe(303);
    expect(failedAuth.headers.get("location")).toBe(`${DEFAULT_ORIGIN}/integrations?google=retry`);
  });

  it("authorizes successfully on valid callback and clears the flow binding cookie", async () => {
    const cookieName = mocks.googleFlowCookie(VALID_STATE);
    const req = makeReq(
      `?state=${VALID_STATE}&code=valid_auth_code&iss=https://accounts.google.com`,
      { cookies: `${cookieName}=binding_secret` },
    );

    const res = await GET(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${DEFAULT_ORIGIN}/integrations?google=authorized`);

    expect(mocks.completeGoogleAuthorization).toHaveBeenCalledWith(
      VALID_STATE,
      "binding_secret",
      "valid_auth_code",
      false,
    );

    // Flow binding cookie must be cleared on response
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(cookieName);
    expect(setCookie).toContain("Max-Age=0");
  });
});
