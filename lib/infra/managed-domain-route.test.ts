import { describe, expect, it, vi } from "vitest";
import type { ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { inspectRemoteManagedDomain, reconcileRemoteManagedDomain } from "./managed-domain-route";

const input: ManagedDomainRoute = {
  hostname: "9router.example.com", cockpitHostname: "mso.example.com", localOrigin: "http://127.0.0.1:4005",
  zoneId: "a".repeat(32), zoneName: "example.com", accountId: "b".repeat(32),
  tunnelId: "11111111-2222-3333-4444-555555555555", ownerTag: "mso:owner:9router",
};
const cockpit = { hostname: input.cockpitHostname, service: input.localOrigin, originRequest: { connectTimeout: 20 } };
const app = { ...cockpit, hostname: input.hostname };
const terminal = { service: "http_status:404" };
const original = { ingress: [cockpit, { hostname: "other.example.com", service: "http://127.0.0.1:8080" },
  { hostname: "*.example.com", service: "http://127.0.0.1:9090" }, terminal], originRequest: { tcpKeepAlive: 30 }, "warp-routing": { enabled: true } };

function fixture(config: Record<string, unknown> = original) {
  let saved = structuredClone(config);
  let corruptAfterWrite = false, reorderKeys = false;
  const call = vi.fn(async (_resource: string, _label: string, init: RequestInit = {}) => {
    if (init.method) {
      saved = JSON.parse(String(init.body)).config;
      if (corruptAfterWrite) saved["warp-routing"] = { enabled: false };
    }
    const observed = reorderKeys ? Object.fromEntries(Object.entries(saved).reverse()) : saved;
    return { result: { config: structuredClone(observed), source: "cloudflare", tunnel_id: input.tunnelId } };
  });
  return { client: { call, tunnelPath: "/accounts/account/cfd_tunnel/tunnel" }, call,
    get config() { return saved; }, concurrentChange() { corruptAfterWrite = true; }, reorder() { reorderKeys = true; } };
}

describe("managed domain tunnel route reconciliation", () => {
  it("inserts before wildcard, preserves unrelated settings, and is idempotent", async () => {
    const f = fixture();
    await expect(reconcileRemoteManagedDomain(f.client, input)).resolves.toEqual({ action: "created" });
    expect(f.config).toEqual({ ...original, ingress: [original.ingress[0], original.ingress[1], app, original.ingress[2], terminal] });
    await expect(reconcileRemoteManagedDomain(f.client, input)).resolves.toEqual({ action: "unchanged" });
    expect(f.call.mock.calls.filter(([, , init]) => init?.method)).toHaveLength(1);
    expect(f.call.mock.calls.find(([, , init]) => init?.method)?.[2]?.method).toBe("PUT");
  });

  it("copies cockpit transport options while adapting its explicit Host header", async () => {
    const f = fixture({ ingress: [{ ...cockpit, originRequest: { connectTimeout: 20, httpHostHeader: input.cockpitHostname } }, terminal] });
    await reconcileRemoteManagedDomain(f.client, input);
    expect((f.config.ingress as Record<string, unknown>[])[1]).toEqual({ ...app,
      originRequest: { connectTimeout: 20, httpHostHeader: input.hostname } });
  });

  it("accepts provider JSON key reordering while preserving ingress order", async () => {
    const f = fixture(); f.reorder();
    await expect(reconcileRemoteManagedDomain(f.client, input)).resolves.toEqual({ action: "created" });
  });

  it.each([
    { ingress: [{ ...cockpit, service: "http://127.0.0.1:9000" }, terminal] },
    { ingress: [{ ...cockpit, path: "/dashboard" }, terminal] },
    { ingress: [cockpit, cockpit, terminal] },
    { ingress: [{ hostname: "*.example.com", service: input.localOrigin }, cockpit, terminal] },
    { ingress: [terminal, cockpit] },
    { ingress: [cockpit] },
    { ingress: [cockpit, { ...app, service: "http://127.0.0.1:20128" }, terminal] },
    { ingress: [cockpit, { ...app, path: "/dashboard" }, terminal] },
    { ingress: [cockpit, app, { ...app, path: "/api" }, terminal] },
  ])("refuses mismatched, shadowed or ambiguous existing routes", async config => {
    const f = fixture(config);
    await expect(inspectRemoteManagedDomain(f.client, input)).rejects.toThrow();
    expect(f.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
  });

  it.each([
    { ingress: [cockpit, terminal], originRequest: { httpHostHeader: input.cockpitHostname } },
    { ingress: [{ ...cockpit, originRequest: { httpHostHeader: "wrong.example.com" } }, terminal] },
    { ingress: [cockpit, { ...app, originRequest: { httpHostHeader: input.cockpitHostname } }, terminal] },
  ])("refuses origin Host overrides that would defeat the app auth router", async config => {
    const f = fixture(config);
    await expect(inspectRemoteManagedDomain(f.client, input)).rejects.toThrow("httpHostHeader");
    expect(f.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
  });

  it("detects an unrelated concurrent change in the full configuration reread", async () => {
    const f = fixture(); f.concurrentChange();
    await expect(reconcileRemoteManagedDomain(f.client, input)).rejects.toThrow("changed during verification");
    expect(f.call.mock.calls.filter(([, , init]) => init?.method)).toHaveLength(1);
  });
});
