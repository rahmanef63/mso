import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { composioAuthHeader, composioKeyKind, doctorComposio } from "./composio";

afterEach(() => vi.unstubAllGlobals());

describe("composio credential routing", () => {
  it("routes each key kind to its own header", () => {
    expect(composioAuthHeader({ apiKey: "ak_project" })).toEqual({ header: { "x-api-key": "ak_project" }, kind: "project" });
    expect(composioAuthHeader({ apiKey: "uak_user" })).toEqual({ header: { "x-user-api-key": "uak_user" }, kind: "user" });
    expect(composioAuthHeader({ orgApiKey: "org_admin", apiKey: "ak_project" })).toEqual({ header: { "x-org-api-key": "org_admin" }, kind: "organization" });
    expect(composioAuthHeader({})).toBeNull();
  });

  it("validates a user key at the session endpoint, never as x-api-key", async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-user-api-key")).toBe("uak_synthetic_user_key");
      expect(headers.has("x-api-key")).toBe(false);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", mock);
    await expect(doctorComposio({ apiKey: "uak_synthetic_user_key" })).resolves.toBe("Composio user key accepted");
    expect(String(mock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/auth/session/info");
  });

  it("reports a rejected key instead of claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(doctorComposio({ apiKey: "uak_synthetic_user_key" })).rejects.toThrow("Composio rejected this user key (401)");
  });
});

describe("composio connect consumer keys", () => {
  it("refuses a ck_ Connect key instead of sending it to the Platform API", () => {
    expect(() => composioAuthHeader({ apiKey: "ck_consumer_key" })).toThrow(/Project MCP/);
    expect(() => composioAuthHeader({ orgApiKey: "ck_consumer_key" })).toThrow(/Project MCP/);
    expect(() => composioAuthHeader({ apiKey: "ak_project" })).not.toThrow();
  });

  it("reports the key kind for a form without exposing the value", () => {
    expect(composioKeyKind({ apiKey: "ak_project" })).toBe("project");
    expect(composioKeyKind({ apiKey: "uak_user" })).toBe("user");
    expect(composioKeyKind({ orgApiKey: "org_admin" })).toBe("organization");
    expect(composioKeyKind({ apiKey: "ck_consumer_key" })).toBe("connect");
    expect(composioKeyKind({})).toBeNull();
  });
});
