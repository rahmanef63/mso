import { describe, expect, it } from "vitest";
import { buildOrcaWebClientUrl, parsePairingCodeFromUrl, validateOrcaPairingUrl } from "./orca-pairing";

const ORIGIN = "https://orca.mso.example.com";
// The trusted managed endpoint is the exact configured split origin, nothing else:
// no path, no query, no userinfo. The browser adds `?orca-client=web` when it opens
// the socket itself; the OFFER must not smuggle one in.
const WSS_ENDPOINT = "wss://orca.mso.example.com";

function encode(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `orca://pair?code=${b64}`;
}

function offer(overrides: Record<string, unknown> = {}): string {
  return encode({
    v: 2,
    endpoint: WSS_ENDPOINT,
    deviceToken: "token_1234567890abcdef",
    publicKeyB64: "pubkey_b64_xyz123",
    scope: "runtime",
    ...overrides,
  });
}

describe("Orca pairing offer validation", () => {
  it("accepts a v2 runtime offer bound to the exact configured WSS origin", () => {
    const validated = validateOrcaPairingUrl(offer(), ORIGIN);
    expect(validated).not.toBeNull();
    expect(validated?.endpoint).toBe(WSS_ENDPOINT);
    expect(validated?.deviceToken).toBe("token_1234567890abcdef");
    expect(validated?.scope).toBe("runtime");
  });

  it("accepts the pairing code passed as a bare URL fragment", () => {
    const code = parsePairingCodeFromUrl(offer());
    expect(code).not.toBeNull();
    const validated = validateOrcaPairingUrl(`orca://pair#${code}`, ORIGIN);
    expect(validated?.endpoint).toBe(WSS_ENDPOINT);
  });

  it("requires scope to be explicitly runtime (absent upstream scope is the mobile/legacy shape)", () => {
    expect(validateOrcaPairingUrl(offer({ scope: undefined }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ scope: "mobile" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ scope: "relay" }), ORIGIN)).toBeNull();
  });

  it("rejects relay offers even when the endpoint origin looks correct", () => {
    expect(validateOrcaPairingUrl(offer({ relay: { url: "wss://relay.example.com" } }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ relayUrl: "wss://relay.example.com" }), ORIGIN)).toBeNull();
  });

  it("rejects endpoints with a path, query, fragment, or userinfo", () => {
    expect(validateOrcaPairingUrl(offer({ endpoint: `${WSS_ENDPOINT}/socket` }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ endpoint: `${WSS_ENDPOINT}?orca-client=web` }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ endpoint: `${WSS_ENDPOINT}#frag` }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ endpoint: "wss://user:pass@orca.mso.example.com" }), ORIGIN)).toBeNull();
  });

  it("rejects wrong origin, sibling app host, non-WSS scheme, and non-HTTPS configured prefix", () => {
    expect(validateOrcaPairingUrl(offer({ endpoint: "wss://evil.example.com" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ endpoint: "wss://hermes.mso.example.com" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ endpoint: "ws://orca.mso.example.com" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ endpoint: "https://orca.mso.example.com" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer(), "http://orca.mso.example.com")).toBeNull();
  });

  it("rejects malformed, empty, or oversized tokens and keys", () => {
    expect(validateOrcaPairingUrl(offer({ deviceToken: "" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ deviceToken: "x".repeat(600) }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ deviceToken: "has space" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ publicKeyB64: "" }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ publicKeyB64: "x".repeat(3000) }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ publicKeyB64: "not base64!!" }), ORIGIN)).toBeNull();
  });

  it("rejects desktop-control grants defensively", () => {
    expect(validateOrcaPairingUrl(offer({ grants: ["desktop-control"] }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ grantDesktopControl: true }), ORIGIN)).toBeNull();
  });

  it("rejects versions other than 2 and malformed or oversized input", () => {
    expect(validateOrcaPairingUrl(offer({ v: 1 }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl("orca://pair?code=not_base64!!!", ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl("https://orca.mso.example.com/pair", ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(`orca://pair?${"a".repeat(5000)}`, ORIGIN)).toBeNull();
    // Duplicate code parameters are ambiguous: never pick one.
    const dup = `${offer()}&code=${parsePairingCodeFromUrl(offer())}`;
    expect(parsePairingCodeFromUrl(dup)).toBeNull();
  });
});

describe("canonical Orca web client URL", () => {
  it("builds https://app/web-index.html#pairing=<encoded> with no query or extra fragment", () => {
    const pairingUrl = "orca://pair?code=abc-123_XYZ";
    const web = buildOrcaWebClientUrl(ORIGIN, pairingUrl);
    const parsed = new URL(web);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.pathname).toBe("/web-index.html");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#pairing=${encodeURIComponent(pairingUrl)}`);
    expect(parsed.hash).not.toContain("token");
  });
});
