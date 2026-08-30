import crypto from "crypto";

// Signed-cookie session. No Convex/JWT — an HMAC over a base64url payload,
// keyed by OS_SESSION_SECRET.

/** Minimum length for the signing secret. A short/empty key is forgeable. */
export const MIN_SECRET_LEN = 32;

/** Maximum UTF-8 size accepted by the fixed-width secret comparator. */
export const MAX_COMPARE_BYTES = 1024;

/**
 * Length-safe constant-time string compare. This is comparison, not password
 * storage: both cleartext inputs are copied into fixed-width buffers and their
 * byte lengths are included in the compared bytes. No fast password verifier is
 * created or persisted, and unequal lengths do not take an early-return path.
 * Callers reject over-limit network input before invoking it.
 */
function fixedCompareBuffer(value: string): { buffer: Buffer; valid: boolean } {
  const bytes = Buffer.from(value, "utf8");
  const out = Buffer.alloc(MAX_COMPARE_BYTES + 4);
  bytes.copy(out, 0, 0, Math.min(bytes.length, MAX_COMPARE_BYTES));
  out.writeUInt32BE(Math.min(bytes.length, MAX_COMPARE_BYTES + 1), MAX_COMPARE_BYTES);
  return { buffer: out, valid: bytes.length <= MAX_COMPARE_BYTES };
}

export function constantTimeEq(a: string, b: string): boolean {
  const left = fixedCompareBuffer(a);
  const right = fixedCompareBuffer(b);
  const same = crypto.timingSafeEqual(left.buffer, right.buffer);
  return left.valid && right.valid && same;
}

export interface SessionPayload {
  issued_at: number;
  expires_at: number;
  /** Approved device this session was issued to (traceability). */
  device_id?: string;
}

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function signSession(payload: SessionPayload, secret: string): string {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(encodedPayload);
  return `${encodedPayload}.${base64urlEncode(hmac.digest())}`;
}

// Shape-guard the post-HMAC JSON. The cookie is already HMAC-verified above, so
// this is defense-in-depth: it stops a malformed-but-somehow-signed payload (or
// a future signing-code bug) from flowing a non-string device_id into the
// approved-device lookup / audit trail as if it were a valid SessionPayload.
function isSessionPayload(v: unknown): v is SessionPayload {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.issued_at === "number" &&
    typeof o.expires_at === "number" &&
    (o.device_id === undefined || typeof o.device_id === "string")
  );
}

export function verifySession(cookie: string, secret: string): SessionPayload | null {
  try {
    // Fail-closed: a missing/short signing key means anyone could forge a
    // cookie. Reject every cookie rather than validate against a weak key.
    if (!secret || secret.length < MIN_SECRET_LEN) return null;

    const parts = cookie.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, providedSig] = parts;

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(encodedPayload);
    const expectedSig = base64urlEncode(hmac.digest());

    // constantTimeEq hashes both sides to fixed width, so an attacker can't
    // probe the expected signature's length via timing.
    if (!constantTimeEq(expectedSig, providedSig)) return null;

    const payload: unknown = JSON.parse(base64urlDecode(encodedPayload).toString("utf8"));
    if (!isSessionPayload(payload) || payload.expires_at <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
