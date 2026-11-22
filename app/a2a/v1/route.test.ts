import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateA2AInboundToken: vi.fn(),
}));

vi.mock("@/lib/a2a/credentials", () => ({
  authenticateA2AInboundToken: mocks.authenticateA2AInboundToken,
}));

import { GET, POST } from "./route";

const ORIGIN = "https://mso.agent.test";

function makePost(body: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/a2a/v1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
  vi.stubEnv("OS_A2A_INBOUND_ENABLED", "1");
  vi.stubEnv("OS_PUBLIC_ORIGIN", ORIGIN);
  mocks.authenticateA2AInboundToken.mockResolvedValue(null);
});

describe("GET /a2a/v1", () => {
  it("refuses GET requests with 405 Method Not Allowed", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});

describe("POST /a2a/v1 authentication and payload validation", () => {
  it("refuses unauthenticated requests without Authorization header with 401", async () => {
    const res = await POST(makePost(JSON.stringify({ jsonrpc: "2.0", method: "Ping" })));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="mso-a2a"');
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("refuses invalid bearer tokens with 401", async () => {
    mocks.authenticateA2AInboundToken.mockResolvedValue(null);
    const res = await POST(
      makePost(JSON.stringify({ jsonrpc: "2.0", method: "Ping" }), {
        authorization: "Bearer invalid-token",
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects malformed non-JSON payloads with JSON-RPC parse error (-32700)", async () => {
    mocks.authenticateA2AInboundToken.mockResolvedValue({
      id: "tok_test_1",
      label: "peer-token",
      scope: "read",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await POST(
      makePost("not a json payload {{{", {
        authorization: "Bearer valid-token",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
  });

  it("rejects invalid JSON-RPC structure missing method or jsonrpc 2.0 with -32600", async () => {
    mocks.authenticateA2AInboundToken.mockResolvedValue({
      id: "tok_test_1",
      label: "peer-token",
      scope: "read",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    // Missing method
    const resMissingMethod = await POST(
      makePost(JSON.stringify({ jsonrpc: "2.0", id: "req-1" }), {
        authorization: "Bearer valid-token",
      }),
    );
    expect(resMissingMethod.status).toBe(200);
    expect(await resMissingMethod.json()).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      error: {
        code: -32600,
        message: "Invalid Request",
      },
    });

    // Wrong jsonrpc version
    const resWrongVersion = await POST(
      makePost(JSON.stringify({ jsonrpc: "1.0", method: "SendMessage", id: "req-2" }), {
        authorization: "Bearer valid-token",
      }),
    );
    expect(resWrongVersion.status).toBe(200);
    expect(await resWrongVersion.json()).toEqual({
      jsonrpc: "2.0",
      id: "req-2",
      error: {
        code: -32600,
        message: "Invalid Request",
      },
    });
  });

  it("returns 404 when A2A inbound is disabled via configuration", async () => {
    vi.stubEnv("OS_A2A_INBOUND_ENABLED", "0");
    vi.stubEnv("OS_A2A_ALLOW_LOOPBACK", "0");
    const res = await POST(makePost(JSON.stringify({ jsonrpc: "2.0", method: "Ping" })));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
