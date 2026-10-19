/**
 * Upstream Orca pairing URL parser and validator.
 *
 * The offer is opaque credential material produced by the upstream runtime. This
 * module decides only whether MSO may hand it to a browser: the endpoint must be
 * the EXACT configured managed WSS origin (no path, query, fragment, or userinfo),
 * scope must be an explicit `runtime`, and relay / desktop-control shapes are
 * refused. It does not — and cannot — certify the real upstream permission set:
 * upstream does not encode grants here, so any grant claim is refused rather than
 * trusted. The outer MSO Operator gate remains the authorization boundary.
 */
const MAX_PAIRING_INPUT = 4096;
const MAX_PAIRING_CODE = 2048;
const MIN_KEY_LEN = 4;
const MAX_KEY_LEN = 2048;
const CANONICAL_B64URL = /^[A-Za-z0-9_-]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{1,512}$/;
const KEY_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface ValidatedPairingOffer {
  v: 2;
  endpoint: string;
  deviceToken: string;
  publicKeyB64: string;
  scope: "runtime";
  pairedDeviceId?: string;
}

/** `https://host[:port]` → `wss://host[:port]`, or null when the configured
 *  managed origin is not HTTPS (an insecure deployment cannot carry a WSS offer). */
function expectedWebSocketOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return null;
    return `wss://${url.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

function endpointMatchesExpected(endpoint: string, expectedWs: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "wss:") return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
  if (url.pathname !== "" && url.pathname !== "/") return false;
  return url.origin.toLowerCase() === expectedWs;
}

export function parsePairingCodeFromUrl(url: string): string | null {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_PAIRING_INPUT) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "orca:" || parsed.hostname !== "pair") return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  if (parsed.username || parsed.password) return null;
  const codes = parsed.searchParams.getAll("code");
  const fragment = parsed.hash ? parsed.hash.slice(1) : "";
  // A query code and a fragment code together are ambiguous; so are duplicates.
  if (codes.length > 1 || (codes.length === 1 && fragment)) return null;
  if (codes.length === 1) return codes[0] ? codes[0] : null;
  if (!fragment) return null;
  // Fragment form is a single bare token, never another key=value pair.
  if (fragment.includes("&") || fragment.includes("=")) return null;
  return fragment;
}

export function decodePairingBase64(code: string): Record<string, unknown> | null {
  if (!code || code.length > MAX_PAIRING_CODE || !CANONICAL_B64URL.test(code)) return null;
  try {
    const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function validateOrcaPairingUrl(url: string, expectedOrigin: string): ValidatedPairingOffer | null {
  const expectedWs = expectedWebSocketOrigin(expectedOrigin);
  if (!expectedWs) return null;

  const code = parsePairingCodeFromUrl(url);
  if (!code) return null;
  const raw = decodePairingBase64(code);
  if (!raw) return null;

  if (raw.v !== 2) return null;
  // Absent scope is the mobile/legacy shape upstream sent historically: refuse it.
  if (raw.scope !== "runtime") return null;
  // Relay offers never route through MSO's own split origin.
  if ("relay" in raw || "relayUrl" in raw) return null;
  // Upstream does not encode grants in this offer, so a grant claim is refused
  // rather than trusted. Refuse PROPERTY PRESENCE, not truthiness: `false`,
  // `null`, an empty array, a string, or an object is still an unverifiable
  // claim about authority, and desktop control is refused for the record too.
  if ("grants" in raw || "desktopControl" in raw || "grantDesktopControl" in raw) return null;

  if (typeof raw.endpoint !== "string" || !endpointMatchesExpected(raw.endpoint, expectedWs)) return null;
  if (typeof raw.deviceToken !== "string" || !TOKEN_PATTERN.test(raw.deviceToken)) return null;
  if (typeof raw.publicKeyB64 !== "string") return null;
  if (raw.publicKeyB64.length < MIN_KEY_LEN || raw.publicKeyB64.length > MAX_KEY_LEN) return null;
  if (!KEY_PATTERN.test(raw.publicKeyB64)) return null;

  return {
    v: 2,
    endpoint: raw.endpoint,
    deviceToken: raw.deviceToken,
    publicKeyB64: raw.publicKeyB64,
    scope: "runtime",
    pairedDeviceId: typeof raw.pairedDeviceId === "string" ? raw.pairedDeviceId : undefined,
  };
}

/** The one URL MSO will ever frame: the app's own web client on the exact configured
 *  origin, carrying the validated pairing URL in the FRAGMENT only. Never trust an
 *  upstream-provided web client URL, and never place credential material in a query. */
export function buildOrcaWebClientUrl(origin: string, pairingUrl: string): string {
  const base = new URL(origin);
  return `${base.origin}/web-index.html#pairing=${encodeURIComponent(pairingUrl)}`;
}
