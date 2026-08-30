import path from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isUnderRoot } from "@/lib/host/paths";
import { assertSafeUrl, isForbiddenProviderAddress } from "@/lib/host/ssrf";
import { safeEqualHex, sha256b64url, verifyPkce } from "@/lib/mcp/pkce";

const segmentChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-");
const segment = fc.array(segmentChar, { minLength: 1, maxLength: 18 }).map((chars) => chars.join(""));
const octet = fc.integer({ min: 0, max: 255 });
const verifierChar = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~");
const verifier = fc.array(verifierChar, { minLength: 43, maxLength: 128 }).map((chars) => chars.join(""));

function changedSameLength(value: string): string {
  const first = value[0] === "A" ? "B" : "A";
  return first + value.slice(1);
}

describe("property fuzz — security boundaries", () => {
  it("keeps generated descendants inside a root and generated siblings outside it", () => {
    const root = path.resolve("/tmp/mso-property-root");
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 8 }), segment, (parts, siblingName) => {
        const inside = path.join(root, ...parts);
        const outside = path.join(path.dirname(root), `outside-${siblingName}`);
        expect(isUnderRoot(inside, root)).toBe(true);
        expect(isUnderRoot(outside, root)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("rejects generated RFC1918 and loopback IPv4 provider addresses", () => {
    fc.assert(
      fc.property(octet, octet, octet, fc.integer({ min: 16, max: 31 }), (a, b, c, private172) => {
        const addresses = [
          `10.${a}.${b}.${c}`,
          `127.${a}.${b}.${c}`,
          `192.168.${a}.${b}`,
          `172.${private172}.${a}.${b}`,
        ];
        for (const address of addresses) expect(isForbiddenProviderAddress(address)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("never accepts a generated private literal as a provider URL", () => {
    fc.assert(
      fc.property(octet, octet, octet, (a, b, c) => {
        expect(() => assertSafeUrl(`https://10.${a}.${b}.${c}/v1`)).toThrow(/not allowed/i);
        expect(() => assertSafeUrl(`https://127.${a}.${b}.${c}/v1`)).toThrow(/not allowed/i);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps PKCE verification exact across generated RFC7636 verifiers", () => {
    fc.assert(
      fc.property(verifier, (value) => {
        const challenge = sha256b64url(value);
        expect(verifyPkce(value, challenge, "S256")).toBe(true);
        expect(verifyPkce(value, changedSameLength(challenge), "S256")).toBe(false);
        expect(safeEqualHex(challenge, challenge)).toBe(true);
        expect(safeEqualHex(challenge, changedSameLength(challenge))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
