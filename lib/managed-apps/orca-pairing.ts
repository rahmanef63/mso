/**
 * Upstream Orca pairing URL parser and validator.
 * Based on Orca v1.4.230 shared/pairing.ts and mobile-relay-pairing-offer.ts contracts.
 * Strictly verifies same-origin WSS endpoint, runtime scope, and no desktop-control grants.
 */

const MAX_PAIRING_INPUT = 4096;
const MAX_PAIRING_CODE = 2048;
const BASE64URL_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface ValidatedPairingOffer {
  v: number;
  endpoint: string;
  deviceToken: string;
  publicKeyB64: string;
  scope?: "runtime";
  pairedDeviceId?: string;
}

export function parsePairingCodeFromUrl(url: string): string | null {
  if (url.length > MAX_PAIRING_INPUT) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "orca:" || parsed.hostname !== "pair") return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  const code = parsed.searchParams.get("code");
  if (code) return code;
  return parsed.hash ? parsed.hash.slice(1) || null : null;
}

export function decodePairingBase64(code: string): Record<string, unknown> | null {
  if (!code || code.length > MAX_PAIRING_CODE || !BASE64URL_PATTERN.test(code)) return null;
  try {
    const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function validateOrcaPairingUrl(
  url: string,
  expectedOrigin: string,
): ValidatedPairingOffer | null {
  const code = parsePairingCodeFromUrl(url);
  if (!code) return null;
  const raw = decodePairingBase64(code);
  if (!raw) return null;

  if (raw.v !== 2) return null;
  if (typeof raw.endpoint !== "string" || !raw.endpoint) return null;
  if (typeof raw.deviceToken !== "string" || !raw.deviceToken) return null;
  if (typeof raw.publicKeyB64 !== "string" || !raw.publicKeyB64) return null;

  // Mobile pairing is rejected; runtime scope only
  if (raw.scope !== undefined && raw.scope !== "runtime") return null;

  // Reject desktop-control grants
  if (Array.isArray(raw.grants) && raw.grants.includes("desktop-control")) return null;
  if (raw.grantDesktopControl === true) return null;

  // Endpoint must match expected WSS origin
  try {
    const targetUrl = new URL(raw.endpoint);
    const expectedWs = expectedOrigin.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:").toLowerCase();
    if (targetUrl.origin.toLowerCase() !== expectedWs) return null;
  } catch {
    return null;
  }

  return {
    v: raw.v,
    endpoint: raw.endpoint,
    deviceToken: raw.deviceToken,
    publicKeyB64: raw.publicKeyB64,
    scope: (raw.scope as "runtime" | undefined) ?? "runtime",
    pairedDeviceId: typeof raw.pairedDeviceId === "string" ? raw.pairedDeviceId : undefined,
  };
}
