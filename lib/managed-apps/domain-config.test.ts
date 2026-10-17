import { describe, expect, it } from "vitest";
import { cleanDomainOrigin, domainHostname, managedDomainHostname, validateDomainConfig, validateDomainState } from "./domain-config";
import type { ManagedDomainConfig, ManagedDomainState } from "@/lib/contracts/managed-domains";

const config: ManagedDomainConfig = {
  publicOrigin: "https://mso.example.com", hostTemplate: "{id}.mso.example.com",
  localOrigin: "http://127.0.0.1:4005", zoneId: "a".repeat(32), zoneName: "example.com",
  accountId: "b".repeat(32), tunnelId: "12345678-1234-1234-1234-123456789abc",
  user: "owner", connection: "cloudflare-main", autoProvision: true,
};
const state = (): ManagedDomainState => ({ version: 1, revision: 1,
  ownerId: "87654321-1234-1234-1234-123456789abc", config, apps: {} });

describe("managed-domain configuration", () => {
  it("derives known app hosts inside the selected zone without retaining the input object", () => {
    const parsed = validateDomainConfig(config);
    expect(parsed).toEqual(config);
    expect(parsed).not.toBe(config);
    expect(managedDomainHostname(parsed, "9router")).toBe("9router.mso.example.com");
    expect(validateDomainConfig({ ...config, hostTemplate: "{id}-mso.example.com" }).hostTemplate).toBe("{id}-mso.example.com");
    expect(() => managedDomainHostname(parsed, "arbitrary")).toThrow(/unknown managed application/);
  });

  it.each([undefined, "remote", "mso-gateway"])("accepts the supported route mode %s", routeMode => {
    expect(validateDomainConfig({ ...config, routeMode }).routeMode).toBe(routeMode);
  });

  it.each(["*.example.com", "EXAMPLE.com", "127.0.0.1", "localhost", "bad_label.example.com", "-bad.example.com", "bad-.example.com", "example.com.", `${"a".repeat(64)}.example.com`])(
    "rejects an invalid DNS hostname: %s", value => expect(() => domainHostname(value)).toThrow(),
  );

  it("canonicalizes public HTTPS and explicit loopback origins", () => {
    expect(cleanDomainOrigin("https://mso.example.com:443/")).toBe(config.publicOrigin);
    expect(cleanDomainOrigin("http://[::1]:4005", true)).toBe("http://[::1]:4005");
    expect(cleanDomainOrigin("http://localhost:4005", true)).toBe("http://localhost:4005");
  });

  it.each(["http://mso.example.com", "https://mso.example.com:444", "https://user:password@mso.example.com", "https://mso.example.com/path", "https://mso.example.com/?q=1", "https://mso.example.com/#fragment", "https://127.0.0.1"])(
    "rejects unsafe public origins: %s", value => expect(() => cleanDomainOrigin(value)).toThrow(),
  );

  it.each(["http://192.168.1.10:4005", "https://127.0.0.1:4005", "http://localhost", "http://0.0.0.0:4005", "http://127.0.0.1:4005/path"])(
    "rejects a target that is not an explicit HTTP loopback origin: %s", value => expect(() => cleanDomainOrigin(value, true)).toThrow(),
  );

  it.each([
    { apiToken: "not-a-real-secret" }, { routeMode: "external" }, { routeMode: ["remote"] }, { user: "../owner" },
    { accountId: "other-account" }, { tunnelId: "not-a-uuid" }, { autoProvision: "yes" },
    { publicOrigin: "https://mso.example.com/" }, { publicOrigin: "https://mso.other.com" },
    { hostTemplate: "{id}.other.com" }, { hostTemplate: "app.{id}.example.com" },
    { hostTemplate: "{id}.{id}.example.com" }, { hostTemplate: "{id}.com" },
    { publicOrigin: "https://9router.mso.example.com" },
  ])("refuses invalid routing or secret-bearing fields: %j", override => {
    expect(() => validateDomainConfig({ ...config, ...override })).toThrow();
  });

  it("validates saved app identity, resource IDs, and bounded diagnostics", () => {
    const valid = state();
    valid.apps["9router"] = { appId: "9router", hostname: "9router.mso.example.com", phase: "dns-ready", dnsRecordId: "c".repeat(32), updatedAt: 10 };
    expect(validateDomainState(valid)).toEqual(valid);
    for (const override of [{ hostname: "9router.other.com" }, { appId: "hermes" }, { phase: "finished" }, { phase: ["ready"] }, { dnsAction: ["created"] }, { routeAction: ["created"] }, { dnsRecordId: "invalid" }, { error: "x".repeat(513) }, { verifiedAt: 1.5 }, { token: "not-a-real-secret" }]) {
      expect(() => validateDomainState({ ...valid, apps: { "9router": { ...valid.apps["9router"], ...override } } })).toThrow();
    }
    expect(() => validateDomainState({ ...valid, config: null })).toThrow();
    expect(() => validateDomainState({ ...valid, revision: -1 })).toThrow();
    expect(() => validateDomainState({ ...valid, version: 2 })).toThrow();
  });
});
