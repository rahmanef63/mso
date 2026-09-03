import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getClient: vi.fn(),
  storeCode: vi.fn(),
  randomToken: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/mcp/store", () => ({
  getClient: mocks.getClient, storeCode: mocks.storeCode, CODE_TTL_MS: 60_000,
}));
vi.mock("@/lib/mcp/pkce", () => ({
  randomToken: mocks.randomToken,
  isAllowedRedirect: (raw: string) => {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    } catch { return false; }
  },
}));
vi.mock("@/lib/mcp/scope", () => ({
  mcpEnabled: () => true,
  parseScope: (value: string) => (["read", "write", "exec"].includes(value) ? value : "read"),
  clampScope: (value: string) => value,
}));

const { approve } = await import("./actions");

const form = (redirectUri = "https://chatgpt.com/connector/oauth/test") => {
  const data = new FormData();
  data.set("client_id", "chatgpt-client");
  data.set("redirect_uri", redirectUri);
  data.set("code_challenge", "challenge");
  data.set("code_challenge_method", "S256");
  data.set("state", "state-1");
  data.set("scope", "exec");
  data.set("resource", "https://mso.example.test/mcp");
  data.set("issuer", "https://mso.example.test");
  data.set("offline_access", "1");
  return data;
};

describe("OAuth consent approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    mocks.requireSession.mockResolvedValue(true);
    mocks.randomToken.mockReturnValue("mso_code_test");
    mocks.getClient.mockResolvedValue({ name: "ChatGPT", profile: "chatgpt", redirectUris: ["https://chatgpt.com/connector/oauth/test"] });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns the validated callback for explicit top-level navigation", async () => {
    const before = Date.now();
    await expect(approve(form())).resolves.toEqual({
      ok: true,
      redirectTo: "https://chatgpt.com/connector/oauth/test?code=mso_code_test&state=state-1&iss=https%3A%2F%2Fmso.example.test",
    });
    expect(mocks.storeCode).toHaveBeenCalledWith("mso_code_test", expect.objectContaining({
      clientId: "chatgpt-client",
      redirectUri: "https://chatgpt.com/connector/oauth/test",
      codeChallenge: "challenge",
      scope: "exec",
      resource: "https://mso.example.test/mcp",
      profile: "chatgpt",
      offlineAccess: true,
      expiresAt: expect.any(Number),
    }));
    expect(mocks.storeCode.mock.calls[0][1].expiresAt).toBeGreaterThanOrEqual(before + 59_000);
  });

  it("does not mint a code after the owner session expires", async () => {
    mocks.requireSession.mockResolvedValue(false);
    await expect(approve(form())).resolves.toEqual({ ok: false, error: "Not signed in." });
    expect(mocks.storeCode).not.toHaveBeenCalled();
  });
});
