import { describe, expect, it } from "vitest";
import { validateOrcaPairingUrl, parsePairingCodeFromUrl } from "./orca-pairing";

describe("Orca pairing offer validation", () => {
  const ORIGIN = "https://orca.mso.example.com";
  const WSS_ENDPOINT = "wss://orca.mso.example.com/socket?orca-client=web";

  function encodeOffer(payload: Record<string, unknown>): string {
    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `orca://pair?code=${b64}`;
  }

  it("accepts valid v2 runtime pairing offer with same-origin WSS endpoint", () => {
    const url = encodeOffer({
      v: 2,
      endpoint: WSS_ENDPOINT,
      deviceToken: "token_1234567890abcdef",
      publicKeyB64: "pubkey_b64_xyz123",
      scope: "runtime",
    });

    const validated = validateOrcaPairingUrl(url, ORIGIN);
    expect(validated).not.toBeNull();
    expect(validated?.v).toBe(2);
    expect(validated?.endpoint).toBe(WSS_ENDPOINT);
    expect(validated?.deviceToken).toBe("token_1234567890abcdef");
    expect(validated?.scope).toBe("runtime");
  });

  it("accepts pairing code passed as URL fragment", () => {
    const raw = encodeOffer({
      v: 2,
      endpoint: WSS_ENDPOINT,
      deviceToken: "token_abc",
      publicKeyB64: "pub_xyz",
    });
    const code = parsePairingCodeFromUrl(raw);
    const fragmentUrl = `orca://pair#${code}`;
    const validated = validateOrcaPairingUrl(fragmentUrl, ORIGIN);
    expect(validated).not.toBeNull();
    expect(validated?.endpoint).toBe(WSS_ENDPOINT);
  });

  it("rejects mobile-scoped pairing offers", () => {
    const url = encodeOffer({
      v: 2,
      endpoint: WSS_ENDPOINT,
      deviceToken: "tok",
      publicKeyB64: "key",
      scope: "mobile",
    });
    expect(validateOrcaPairingUrl(url, ORIGIN)).toBeNull();
  });

  it("rejects offers with desktop-control grants", () => {
    const urlWithArray = encodeOffer({
      v: 2,
      endpoint: WSS_ENDPOINT,
      deviceToken: "tok",
      publicKeyB64: "key",
      grants: ["desktop-control"],
    });
    expect(validateOrcaPairingUrl(urlWithArray, ORIGIN)).toBeNull();

    const urlWithFlag = encodeOffer({
      v: 2,
      endpoint: WSS_ENDPOINT,
      deviceToken: "tok",
      publicKeyB64: "key",
      grantDesktopControl: true,
    });
    expect(validateOrcaPairingUrl(urlWithFlag, ORIGIN)).toBeNull();
  });

  it("rejects offers pointing to wrong origin or non-WSS endpoints", () => {
    const wrongHost = encodeOffer({
      v: 2,
      endpoint: "wss://evil.example.com/socket",
      deviceToken: "tok",
      publicKeyB64: "key",
    });
    expect(validateOrcaPairingUrl(wrongHost, ORIGIN)).toBeNull();

    const siblingHost = encodeOffer({
      v: 2,
      endpoint: "wss://hermes.mso.example.com/socket",
      deviceToken: "tok",
      publicKeyB64: "key",
    });
    expect(validateOrcaPairingUrl(siblingHost, ORIGIN)).toBeNull();
  });

  it("rejects invalid versions, malformed schemas, and oversized payloads", () => {
    expect(validateOrcaPairingUrl(encodeOffer({ v: 1, endpoint: WSS_ENDPOINT }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl("orca://pair?code=not_base64!!!", ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl("https://orca.mso.example.com/pair", ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl("orca://pair?" + "a".repeat(5000), ORIGIN)).toBeNull();
  });
});
