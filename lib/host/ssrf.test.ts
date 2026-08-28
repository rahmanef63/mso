import { afterEach, describe, expect, it } from "vitest";
import { assertSafeUrl, isForbiddenProviderAddress, resolveSafeProviderEndpoint } from "./ssrf";

const originalHttp = process.env.OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP;
afterEach(() => {
  if (originalHttp === undefined) delete process.env.OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP;
  else process.env.OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP = originalHttp;
});

describe("custom-provider network boundary", () => {
  it("accepts a public HTTPS endpoint", () => {
    expect(assertSafeUrl("https://api.example.com/v1").hostname).toBe("api.example.com");
  });

  it("requires explicit opt-in for insecure HTTP", () => {
    expect(() => assertSafeUrl("http://api.example.com/v1")).toThrow(/must use HTTPS/);
    process.env.OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP = "1";
    expect(assertSafeUrl("http://api.example.com/v1").protocol).toBe("http:");
  });

  it("rejects credentials, fragments and local hostnames", () => {
    for (const url of [
      "https://user:pass@example.com/v1",
      "https://example.com/v1#fragment",
      "https://foo.internal/v1",
      "https://service.local/v1",
      "https://localhost/v1",
    ]) expect(() => assertSafeUrl(url)).toThrow();
  });

  it("classifies private, metadata, documentation, multicast and mapped addresses", () => {
    for (const address of [
      "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.31.1.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1",
      "203.0.113.1", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "ff02::1",
      "2001:db8::1", "::ffff:10.0.0.1",
    ]) expect(isForbiddenProviderAddress(address), address).toBe(true);
    for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
      expect(isForbiddenProviderAddress(address), address).toBe(false);
  });

  it("rejects DNS rebinding answers before any socket is opened", async () => {
    const privateResolver = async () => [{ address: "10.0.0.7", family: 4 as const }];
    await expect(resolveSafeProviderEndpoint("https://provider.example/v1", privateResolver))
      .rejects.toThrow(/DNS resolved/);
  });

  it("rejects mixed public/private DNS answers and pins a fully-public answer", async () => {
    const mixed = async () => [
      { address: "203.0.114.9", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ];
    await expect(resolveSafeProviderEndpoint("https://provider.example/v1", mixed)).rejects.toThrow(/DNS resolved/);
    const publicResolver = async () => [{ address: "203.0.114.9", family: 4 as const }];
    await expect(resolveSafeProviderEndpoint("https://provider.example/v1", publicResolver))
      .resolves.toMatchObject({ address: "203.0.114.9", family: 4 });
  });
});
