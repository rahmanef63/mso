import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// PKCE (RFC 7636) and secret-hashing primitives shared by protocol adapters.
// Raw codes/bearers stay in flight; persistent callers store only hashes.

export function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** base64url, NOT base64 — `+`→`-`, `/`→`_`, no padding. Standard base64 here
 *  silently produces a challenge that never matches (RFC 7636 §4.2). */
export function sha256b64url(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}

export function randomToken(prefix: string, bytes = 32): string {
  return prefix + randomBytes(bytes).toString("base64url");
}

/** Constant-time for equal-length input; length itself is not a secret. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * True when `verifier` is the one that produced `challenge`.
 *
 * `plain` is refused outright — OAuth 2.1 drops it, and accepting it would mean a
 * proxy that saw the authorization redirect could complete the exchange itself.
 * The 43..128 bound is RFC 7636 §4.1: anything outside it cannot be a verifier at
 * all, so rejecting early keeps a malformed value out of the hash comparison.
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  const computed = sha256b64url(verifier);
  return computed.length === challenge.length && safeEqualHex(computed, challenge);
}

/** https, or loopback for a desktop client's local callback. Anything else — a
 *  custom scheme, an http host on the internet — can leak the code in transit. */
export function isAllowedRedirect(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
