import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import os from "node:os";
import path from "node:path";
import { resolveOrcaManagedRoot } from "./orca-private-fs";
import { validateOrcaPairingUrl } from "./orca-pairing";

const HOME = os.homedir();
const INVALID_ROOT = { ok: false, reason: "managed_root_invalid" } as const;

describe("Orca managed root parity with scripts/orca/managed-paths.mjs", () => {
  it("keeps the portable default inside the owner home but outside personal Orca state", () => {
    expect(resolveOrcaManagedRoot({})).toEqual({
      ok: true,
      root: path.join(HOME, ".local", "share", "mso", "orca"),
    });
  });

  it("accepts a clean absolute ORCA_HOME", () => {
    expect(resolveOrcaManagedRoot({ ORCA_HOME: "/srv/mso/orca" })).toEqual({
      ok: true,
      root: "/srv/mso/orca",
    });
  });

  it.each([
    ["filesystem root", "/"],
    ["home directory", HOME],
    ["personal .orca", path.join(HOME, ".orca")],
    ["personal .orca subtree", path.join(HOME, ".orca", "nested")],
    ["personal .orca-remote", path.join(HOME, ".orca-remote")],
    ["personal .orca-remote subtree", path.join(HOME, ".orca-remote", "nested")],
    ["relative path", "relative/orca"],
    ["dot-dot traversal", "/srv/../etc/orca"],
    ["empty override", ""],
    ["blank override", "   "],
  ])("refuses the unsafe %s", (_label, root) => {
    expect(resolveOrcaManagedRoot({ ORCA_HOME: root })).toEqual(INVALID_ROOT);
  });

  it.each([
    ["trailing slash", "/srv/mso/orca/"],
    ["duplicate slash", "/srv//mso/orca"],
    ["dot segment", "/srv/mso/./orca"],
    ["newline control character", "/srv/orca\n"],
    ["carriage-return control character", "/srv/orca\r"],
    ["NUL control character", "/srv\0orca"],
  ])("refuses the dirty %s spelling", (_label, root) => {
    expect(resolveOrcaManagedRoot({ ORCA_HOME: root })).toEqual(INVALID_ROOT);
  });
});

const ORIGIN = "https://orca.mso.example.com";
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

describe("Orca pairing schema refuses grant claims by property presence", () => {
  it("still accepts the existing runtime offer with no optional fields", () => {
    expect(validateOrcaPairingUrl(offer(), ORIGIN)).not.toBeNull();
  });

  it.each([
    ["true", true],
    ["false", false],
    ["null", null],
    ["string", "desktop-control"],
    ["object", { desktop: true }],
    ["empty array", []],
    ["non-empty array", ["desktop-control"]],
  ])("refuses a %s grants property instead of truthiness-checking it", (_label, grants) => {
    expect(validateOrcaPairingUrl(offer({ grants }), ORIGIN)).toBeNull();
  });

  it.each([
    ["true", true],
    ["false", false],
    ["null", null],
    ["string", "false"],
    ["object", {}],
    ["empty array", []],
  ])("refuses a %s desktopControl property instead of truthiness-checking it", (_label, desktopControl) => {
    expect(validateOrcaPairingUrl(offer({ desktopControl }), ORIGIN)).toBeNull();
  });

  it.each([
    ["true", true],
    ["false", false],
    ["null", null],
    ["string", "no"],
    ["object", { enabled: false }],
    ["empty array", []],
  ])("refuses a %s grantDesktopControl property instead of truthiness-checking it", (_label, grantDesktopControl) => {
    expect(validateOrcaPairingUrl(offer({ grantDesktopControl }), ORIGIN)).toBeNull();
  });

  it("still refuses relay offers by property presence", () => {
    expect(validateOrcaPairingUrl(offer({ relay: { url: "wss://relay.example.com" } }), ORIGIN)).toBeNull();
    expect(validateOrcaPairingUrl(offer({ relayUrl: "" }), ORIGIN)).toBeNull();
  });
});
