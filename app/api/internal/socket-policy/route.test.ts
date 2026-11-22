import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socketPolicy: vi.fn(async () => ({ allowed: true, target: "http://127.0.0.1:8080" })),
}));

vi.mock("@/lib/managed-apps/socket-policy", () => ({
  socketPolicy: mocks.socketPolicy,
}));

import { POST } from "./route";

const VALID_SECRET = "test-secret-at-least-32-characters-long-policy-key";

function makeReq(options: {
  secret?: string;
  authHeader?: string;
  body?: unknown;
}): Request {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (options.authHeader !== undefined) {
    headers.set("authorization", options.authHeader);
  } else if (options.secret !== undefined) {
    headers.set("authorization", `Bearer ${options.secret}`);
  }

  const rawBody =
    options.body === undefined
      ? JSON.stringify({ url: "https://mso.example/ws", headers: { host: "mso.example" } })
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  return new Request("https://mso.example/api/internal/socket-policy", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

const originalSecret = process.env.MSO_SOCKET_POLICY_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MSO_SOCKET_POLICY_SECRET = VALID_SECRET;
  mocks.socketPolicy.mockResolvedValue({ allowed: true, target: "http://127.0.0.1:8080" });
});

afterEach(() => {
  if (originalSecret !== undefined) {
    process.env.MSO_SOCKET_POLICY_SECRET = originalSecret;
  } else {
    delete process.env.MSO_SOCKET_POLICY_SECRET;
  }
});

describe("POST /api/internal/socket-policy", () => {
  describe("deliberate 404 stealth behavior", () => {
    // This route deliberately hides its existence behind 404 rather than 401/403.
    it("returns 404 when MSO_SOCKET_POLICY_SECRET is not configured", async () => {
      delete process.env.MSO_SOCKET_POLICY_SECRET;
      const res = await POST(makeReq({ secret: VALID_SECRET }));
      expect(res.status).toBe(404);
      expect(mocks.socketPolicy).not.toHaveBeenCalled();
    });

    it("returns 404 when configured secret is shorter than 32 characters", async () => {
      const shortSecret = "short-secret-under-32-bytes";
      process.env.MSO_SOCKET_POLICY_SECRET = shortSecret;
      const res = await POST(makeReq({ secret: shortSecret }));
      expect(res.status).toBe(404);
      expect(mocks.socketPolicy).not.toHaveBeenCalled();
    });

    it("returns 404 when authorization header is missing", async () => {
      const res = await POST(makeReq({}));
      expect(res.status).toBe(404);
      expect(mocks.socketPolicy).not.toHaveBeenCalled();
    });

    it("returns 404 when bearer token does not match secret", async () => {
      const res = await POST(makeReq({ secret: "wrong-bearer-secret-that-has-over-32-characters-here" }));
      expect(res.status).toBe(404);
      expect(mocks.socketPolicy).not.toHaveBeenCalled();
    });

    it("returns 404 when authorization scheme is not Bearer", async () => {
      const res = await POST(makeReq({ authHeader: `Basic ${VALID_SECRET}` }));
      expect(res.status).toBe(404);
      expect(mocks.socketPolicy).not.toHaveBeenCalled();
    });
  });

  describe("authenticated policy evaluation", () => {
    it("evaluates socket policy and returns 200 with no-store cache header on success", async () => {
      const res = await POST(
        makeReq({
          secret: VALID_SECRET,
          body: { url: "https://mso.example/ws", headers: { upgrade: "websocket" } },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ allowed: true, target: "http://127.0.0.1:8080" });
      expect(mocks.socketPolicy).toHaveBeenCalledOnce();
    });

    it("returns 403 when socket policy evaluates to falsy / null decision", async () => {
      mocks.socketPolicy.mockResolvedValue(null as unknown as { allowed: boolean; target: string });
      const res = await POST(makeReq({ secret: VALID_SECRET }));
      expect(res.status).toBe(403);
    });

    it("returns 403 when request body is invalid JSON", async () => {
      const res = await POST(makeReq({ secret: VALID_SECRET, body: "not-json" }));
      expect(res.status).toBe(403);
      expect(mocks.socketPolicy).not.toHaveBeenCalled();
    });
  });
});
