import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { request } from "./http";
import { readInfraProvider } from "./store";
import { ensureManagedDomainGateway, inspectManagedDomainGateway } from "./managed-domain-gateway";
import { ensureManagedDomainDns, ensureManagedDomainRoute, inspectManagedDomainRoute } from "./managed-domain";

vi.mock("./store", () => ({ readInfraProvider: vi.fn() }));
vi.mock("./http", async importOriginal => ({ ...await importOriginal<typeof import("./http")>(), request: vi.fn() }));
vi.mock("./managed-domain-gateway", () => ({ ensureManagedDomainGateway: vi.fn(), inspectManagedDomainGateway: vi.fn() }));

const input: ManagedDomainRoute = {
  hostname: "9router.example.com", cockpitHostname: "mso.example.com", localOrigin: "http://127.0.0.1:4005",
  zoneId: "a".repeat(32), zoneName: "example.com", accountId: "b".repeat(32),
  tunnelId: "11111111-2222-3333-4444-555555555555", ownerTag: "mso:owner:9router",
};
let source: string, zoneAccount: string, records: Record<string, unknown>[];

beforeEach(() => {
  vi.resetAllMocks();
  source = "cloudflare"; zoneAccount = input.accountId; records = [];
  vi.mocked(readInfraProvider).mockResolvedValue({ apiToken: "private-test-token", zoneId: input.zoneId, accountId: input.accountId });
  vi.mocked(inspectManagedDomainGateway).mockResolvedValue(undefined);
  vi.mocked(ensureManagedDomainGateway).mockResolvedValue({ action: "unchanged" });
  vi.mocked(request).mockImplementation(async (url, init = {}) => {
    expect(init.headers).toMatchObject({ authorization: "Bearer private-test-token" });
    const path = new URL(url).pathname;
    let result: unknown;
    if (path.endsWith("/configurations")) result = { source, tunnel_id: input.tunnelId, config: { ingress: [
      { hostname: input.cockpitHostname, service: input.localOrigin }, { service: "http_status:404" },
    ] } };
    else if (path.endsWith("/dns_records")) result = records;
    else if (path.includes("/cfd_tunnel/")) result = { id: input.tunnelId, config_src: source, deleted_at: null };
    else result = { id: input.zoneId, name: input.zoneName, account: { id: zoneAccount }, status: "active" };
    return { status: 200, ok: true, body: { success: true, result }, text: "" };
  });
});

describe("managed domain provider preflight and source dispatch", () => {
  it("checks the selected connection, zone, tunnel, cockpit and DNS without writes", async () => {
    await inspectManagedDomainRoute(input);
    expect(readInfraProvider).toHaveBeenCalledWith("cloudflare");
    expect(request).toHaveBeenCalledTimes(4);
    expect(vi.mocked(request).mock.calls.every(([, init]) => !init?.method)).toBe(true);
    expect(inspectManagedDomainGateway).not.toHaveBeenCalled();
  });

  it("rejects a foreign zone account before inspecting or changing the tunnel", async () => {
    zoneAccount = "f".repeat(32);
    await expect(inspectManagedDomainRoute(input)).rejects.toThrow("zone ID, name and account");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a connection whose configured target differs without making requests", async () => {
    vi.mocked(readInfraProvider).mockResolvedValue({ apiToken: "private-test-token", zoneId: "f".repeat(32) });
    await expect(inspectManagedDomainRoute(input)).rejects.toThrow("selected Cloudflare connection");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects local and unknown source tunnels before any DNS operation", async () => {
    source = "local";
    await expect(ensureManagedDomainDns(input)).rejects.toThrow("config_src=local");
    source = "unknown";
    await expect(inspectManagedDomainRoute(input)).rejects.toThrow("configuration source is unknown");
    expect(vi.mocked(request).mock.calls.every(([url, init]) => !url.includes("dns_records") && !init?.method)).toBe(true);
    expect(ensureManagedDomainGateway).not.toHaveBeenCalled();
  });

  it("delegates an explicitly selected local tunnel to the MSO-owned gateway", async () => {
    source = "local";
    const local = { ...input, routeMode: "mso-gateway" as const, hostTemplate: "{id}.example.com" };
    await inspectManagedDomainRoute(local);
    await expect(ensureManagedDomainRoute(local)).resolves.toEqual({ action: "unchanged" });
    expect(inspectManagedDomainGateway).toHaveBeenCalledWith(local);
    expect(ensureManagedDomainGateway).toHaveBeenCalledWith(local);
    expect(vi.mocked(request).mock.calls.every(([url]) => !url.includes("configurations"))).toBe(true);
  });

  it("requires fresh setup when a stored local tunnel has become remote", async () => {
    await expect(ensureManagedDomainRoute({ ...input, routeMode: "mso-gateway" })).rejects.toThrow("config_src=cloudflare");
    expect(ensureManagedDomainGateway).not.toHaveBeenCalled();
    expect(vi.mocked(request).mock.calls.every(([url, init]) => !url.includes("configurations") && !init?.method)).toBe(true);
  });

  it("propagates local ownership failure before DNS lookup or any mutation", async () => {
    source = "local";
    vi.mocked(inspectManagedDomainGateway).mockRejectedValue(new Error("tunnel is externally owned"));
    await expect(inspectManagedDomainRoute({ ...input, routeMode: "mso-gateway" })).rejects.toThrow("externally owned");
    expect(vi.mocked(request).mock.calls.every(([url, init]) => !url.includes("dns_records") && !init?.method)).toBe(true);
  });

  it("includes DNS conflict inspection in the no-write preflight", async () => {
    records = [{ id: "d".repeat(32), name: input.hostname, type: "A", content: "192.0.2.1" }];
    await expect(inspectManagedDomainRoute(input)).rejects.toThrow("DNS conflict");
    expect(vi.mocked(request).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it.each(["https://127.0.0.1:4005", "http://127.0.0.1", "http://192.0.2.1:4005", "http://user:secret@127.0.0.1:4005", "http://127.0.0.1:4005/path"])(
    "rejects an unsafe or ambiguous local origin %s before credential use", async localOrigin => {
      await expect(inspectManagedDomainRoute({ ...input, localOrigin })).rejects.toThrow("loopback MSO HTTP service");
      expect(request).not.toHaveBeenCalled(); expect(readInfraProvider).not.toHaveBeenCalled();
    });

  it("never reflects a credential-bearing transport error", async () => {
    vi.mocked(request).mockRejectedValue(new Error("Authorization: Bearer private-test-token"));
    await expect(inspectManagedDomainRoute(input)).rejects.toThrow("zone inspection request failed");
    try { await inspectManagedDomainRoute(input); } catch (error) { expect(String(error)).not.toContain("private-test-token"); }
  });
});
