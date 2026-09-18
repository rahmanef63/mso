import { describe, expect, it } from "vitest";
import { isDeploymentPrivateAddress, PRIVATE_ROUTE_CODE, providerNetworkRefusal } from "./provider-network-policy";

describe("private-route refusal classification does not grant network access", () => {
  it.each(["10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.255.255", "100.64.0.0", "100.127.255.255", "fc00::1", "fd7a:115c:a1e0::4"])("classifies private address %s", address => {
    expect(isDeploymentPrivateAddress(address)).toBe(true);
  });
  it.each(["127.0.0.1", "169.254.169.254", "0.0.0.0", "172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "192.169.0.1", "192.0.2.1", "224.0.0.1", "::1", "::", "fe80::1", "ff02::1", "2001:db8::1", "invalid"])("does not label %s a private deployment route", address => {
    expect(isDeploymentPrivateAddress(address)).toBe(false);
  });
  it("adds a typed hint without changing the thrown refusal message", () => {
    expect(providerNetworkRefusal("denied", true)).toMatchObject({ message: "denied", code: PRIVATE_ROUTE_CODE });
    expect(providerNetworkRefusal("denied")).toMatchObject({ message: "denied", code: "MSO_FORBIDDEN_PROVIDER_ENDPOINT" });
  });
});
