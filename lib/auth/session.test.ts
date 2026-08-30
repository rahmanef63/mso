import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { constantTimeEq, MAX_COMPARE_BYTES, MIN_SECRET_LEN, signSession, verifySession, type SessionPayload } from "./session";

const SECRET = "s".repeat(MIN_SECRET_LEN);

function freshPayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  const now = Date.now();
  return { issued_at: now, expires_at: now + 60_000, device_id: "dev-1", ...overrides };
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Sign an arbitrary (even non-JSON) payload string the same way session.ts does. */
function forgeToken(encodedPayload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(encodedPayload);
  return `${encodedPayload}.${b64url(hmac.digest())}`;
}

describe("constantTimeEq fixed-width comparison", () => {
  it("compares equal and unequal values without creating a password hash", () => {
    expect(constantTimeEq("correct-horse", "correct-horse")).toBe(true);
    expect(constantTimeEq("correct-horse", "correct-house")).toBe(false);
    expect(constantTimeEq("short", "shorter")).toBe(false);
  });

  it("fails closed when either UTF-8 value exceeds the fixed-width ceiling", () => {
    const oversized = "a".repeat(MAX_COMPARE_BYTES + 1);
    expect(constantTimeEq(oversized, oversized)).toBe(false);
    expect(constantTimeEq("a", oversized)).toBe(false);
  });
});

describe("signSession / verifySession roundtrip", () => {
  it("verifies a token it signed and returns the exact payload", () => {
    const payload = freshPayload();
    const token = signSession(payload, SECRET);
    expect(verifySession(token, SECRET)).toEqual(payload);
  });

  it("roundtrips a payload without device_id", () => {
    const payload = freshPayload();
    delete payload.device_id;
    expect(verifySession(signSession(payload, SECRET), SECRET)).toEqual(payload);
  });
});

describe("verifySession rejects forgery", () => {
  it("rejects a tampered payload with the original signature", () => {
    const token = signSession(freshPayload(), SECRET);
    const [, sig] = token.split(".");
    const evil = b64url(JSON.stringify(freshPayload({ expires_at: Date.now() + 1e9 })));
    expect(verifySession(`${evil}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects a tampered signature of the same length", () => {
    const token = signSession(freshPayload(), SECRET);
    const last = token.slice(-1);
    const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(verifySession(flipped, SECRET)).toBeNull();
  });

  it("rejects a signature of a different length", () => {
    const token = signSession(freshPayload(), SECRET);
    expect(verifySession(`${token}xx`, SECRET)).toBeNull();
  });

  it("rejects a signature lifted from a different payload", () => {
    const a = signSession(freshPayload({ device_id: "a" }), SECRET);
    const b = signSession(freshPayload({ device_id: "b" }), SECRET);
    const mixed = `${a.split(".")[0]}.${b.split(".")[1]}`;
    expect(verifySession(mixed, SECRET)).toBeNull();
  });

  it("rejects a token verified with the wrong secret", () => {
    const token = signSession(freshPayload(), SECRET);
    expect(verifySession(token, "x".repeat(MIN_SECRET_LEN))).toBeNull();
  });
});

describe("verifySession fail-closed on weak secret", () => {
  it("rejects every token when the secret is shorter than MIN_SECRET_LEN", () => {
    const short = "s".repeat(MIN_SECRET_LEN - 1);
    const token = signSession(freshPayload(), short); // signed with the SAME weak key
    expect(verifySession(token, short)).toBeNull();
  });

  it("rejects every token when the secret is empty", () => {
    const token = signSession(freshPayload(), SECRET);
    expect(verifySession(token, "")).toBeNull();
  });
});

describe("verifySession expiry", () => {
  it("rejects an expired session (expires_at in the past)", () => {
    const token = signSession(freshPayload({ expires_at: Date.now() - 1000 }), SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("rejects expires_at == now (boundary is inclusive)", () => {
    const token = signSession(freshPayload({ expires_at: Date.now() - 1 }), SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("rejects a NaN expires_at (JSON serializes NaN to null, null coerces expired)", () => {
    const token = signSession(freshPayload({ expires_at: NaN }), SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  // A payload missing expires_at must NOT become a never-expiring session
  // (`undefined <= n` is false): verifySession requires a numeric expires_at.
  it("rejects a signed payload with expires_at missing", () => {
    const encoded = b64url(JSON.stringify({ issued_at: Date.now() }));
    const token = forgeToken(encoded, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });
});

describe("verifySession malformed tokens", () => {
  it("rejects an empty string", () => {
    expect(verifySession("", SECRET)).toBeNull();
  });

  it("rejects a token with no dot", () => {
    expect(verifySession("just-one-part-no-dot", SECRET)).toBeNull();
  });

  it("rejects a token with more than two parts", () => {
    const [p, s] = signSession(freshPayload(), SECRET).split(".");
    expect(verifySession(`${p}.${s}.extra`, SECRET)).toBeNull();
  });

  it("rejects a correctly-signed payload that is not base64 JSON", () => {
    expect(verifySession(forgeToken("!!!!not-base64!!!!", SECRET), SECRET)).toBeNull();
  });

  it("rejects a correctly-signed payload that decodes to non-JSON text", () => {
    expect(verifySession(forgeToken(b64url("hello world"), SECRET), SECRET)).toBeNull();
  });
});
