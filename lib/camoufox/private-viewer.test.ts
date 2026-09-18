import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resolveSafeProviderEndpoint } from "@/lib/host/ssrf";
import { inspectViewerTransport } from "./viewer-transport";

async function inspect(addresses: string[]) {
  return inspectViewerTransport("https://camoufox.example.com", async () => {
    await resolveSafeProviderEndpoint("https://camoufox.example.com", async () => addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })));
    throw new Error("A forbidden address unexpectedly escaped the server guard");
  });
}
describe("deployment-owned private viewer diagnostics", () => {
  it.each(["10.0.0.4", "172.16.0.4", "192.168.1.4", "100.64.0.4", "fd7a:115c:a1e0::4"])("keeps %s server-blocked and delegates reachability to the client", async address => {
    await expect(resolveSafeProviderEndpoint("https://viewer.example", async () => [{ address, family: address.includes(":") ? 6 : 4 }])).rejects.toThrow(/DNS resolved/);
    expect(await inspect([address])).toMatchObject({ reachable: false, state: "client-only", clientOnly: true });
  });
  it.each(["127.0.0.1", "169.254.169.254", "fe80::1", "::1", "0.0.0.0"])("never treats unsafe address %s as client-verifiable private routing", async address => {
    const result = await inspect([address]);
    expect(result.reachable).toBe(false); expect(result.clientOnly).not.toBe(true);
  });
  it("keeps mixed public/private and private/metadata DNS answers denied", async () => {
    for (const addresses of [["1.1.1.1", "10.0.0.4"], ["10.0.0.4", "169.254.169.254"]])
      expect((await inspect(addresses)).clientOnly).not.toBe(true);
  });
});

  it("does not infer private routing from a local hostname or arbitrary exception text", async () => {
    for (const origin of ["https://viewer.localhost", "https://viewer.internal", "https://169.254.169.254"]) {
      const result = await inspectViewerTransport(origin);
      expect(result.reachable).toBe(false); expect(result.clientOnly).not.toBe(true);
    }
    const result = await inspectViewerTransport("https://viewer.example", async () => {
      throw new Error("MSO_DEPLOYMENT_PRIVATE_ROUTE secret must not be reflected");
    });
    expect(result.clientOnly).not.toBe(true); expect(JSON.stringify(result)).not.toContain("secret");
  });
