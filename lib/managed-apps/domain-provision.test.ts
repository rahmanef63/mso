import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManagedDomainConfig } from "@/lib/contracts/managed-domains";

vi.mock("@/lib/infra/connection-service", () => ({ withIntegrationSelection: vi.fn(async (_selector, run) => run()) }));
vi.mock("@/lib/infra/managed-domain", () => ({ inspectManagedDomainRoute: vi.fn(), ensureManagedDomainDns: vi.fn(), ensureManagedDomainRoute: vi.fn() }));
vi.mock("./domain-probe", () => ({ probeLocalManagedDomain: vi.fn(), probePublicManagedDomain: vi.fn() }));
vi.mock("./domain-health", () => ({ probeManagedAppRuntime: vi.fn() }));
const provider = await import("@/lib/infra/managed-domain");
const probes = await import("./domain-probe");
const { probeManagedAppRuntime } = await import("./domain-health");
const { ensureManagedAppDomain } = await import("./domain-provision");
const { readManagedDomains, saveManagedDomainConfig } = await import("./domain-store");
const { provisionDomainAfterStart, readManagedDomainView } = await import("./domain-lifecycle");

const config: ManagedDomainConfig = { publicOrigin: "https://mso.example.com", hostTemplate: "{id}.mso.example.com",
  localOrigin: "http://127.0.0.1:4005", zoneId: "a".repeat(32), zoneName: "example.com", accountId: "b".repeat(32),
  tunnelId: "11111111-1111-4111-8111-111111111111", user: "owner", connection: "dns", autoProvision: true };
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-domain-provision-"));
  vi.stubEnv("OS_MANAGED_DOMAINS_STORE", path.join(directory, "domains.json"));
  vi.mocked(probes.probeLocalManagedDomain).mockReset().mockResolvedValue();
  vi.mocked(probes.probePublicManagedDomain).mockReset().mockResolvedValue();
  vi.mocked(probeManagedAppRuntime).mockReset().mockResolvedValue();
  vi.mocked(provider.inspectManagedDomainRoute).mockReset().mockResolvedValue();
  vi.mocked(provider.ensureManagedDomainDns).mockReset().mockResolvedValue({ id: "c".repeat(32), action: "created" });
  vi.mocked(provider.ensureManagedDomainRoute).mockReset().mockResolvedValue({ action: "created" });
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

it("makes no external writes before the deployed MSO auth gate passes", async () => {
  await saveManagedDomainConfig(config);
  vi.mocked(probes.probeLocalManagedDomain).mockRejectedValueOnce(new Error("template needs a deploy"));
  expect(await ensureManagedAppDomain("9router")).toMatchObject({ phase: "blocked", error: "template needs a deploy" });
  expect(provider.inspectManagedDomainRoute).not.toHaveBeenCalled();
  expect(provider.ensureManagedDomainDns).not.toHaveBeenCalled();
  expect((await readManagedDomains()).apps["9router"].phase).toBe("blocked");
});

it("retains an authenticated route across DNS interruption and resumes to verified HTTPS", async () => {
  await saveManagedDomainConfig(config);
  vi.mocked(provider.ensureManagedDomainDns).mockRejectedValueOnce(new Error("DNS authorization unavailable"));
  const interrupted = await ensureManagedAppDomain("9router");
  expect(interrupted).toMatchObject({ phase: "blocked", routeAction: "created" });
  expect(interrupted?.dnsRecordId).toBeUndefined();
  expect(interrupted?.verifiedAt).toBeUndefined();
  vi.mocked(provider.ensureManagedDomainRoute).mockResolvedValue({ action: "unchanged" });
  expect(await ensureManagedAppDomain("9router")).toMatchObject({ phase: "ready", routeAction: "unchanged", dnsRecordId: "c".repeat(32), verifiedAt: expect.any(Number) });
  expect((await readManagedDomainView("9router")).domainDiagnostic).toBeNull();
});

it("publishes DNS only after the app ingress has been confirmed", async () => {
  await saveManagedDomainConfig(config);
  vi.mocked(provider.ensureManagedDomainDns).mockImplementation(async () => {
    expect((await readManagedDomains()).apps["9router"]).toMatchObject({ phase: "route-ready", routeAction: "created" });
    return { id: "c".repeat(32), action: "created" };
  });
  expect((await ensureManagedAppDomain("9router"))?.phase).toBe("ready");
});

it("does not call a routed hostname ready while HTTPS or the application is unhealthy", async () => {
  await saveManagedDomainConfig(config);
  vi.mocked(probes.probePublicManagedDomain).mockRejectedValueOnce(new Error("certificate does not cover this hostname"));
  expect(await ensureManagedAppDomain("9router")).toMatchObject({ phase: "blocked", routeAction: "created" });
  vi.mocked(probeManagedAppRuntime).mockRejectedValueOnce(new Error("runtime not healthy"));
  const result = await provisionDomainAfterStart("9router");
  expect(result.domain?.verifiedAt).toBeUndefined();
  expect(result.domainDiagnostic).toBe("runtime not healthy");
});

it("serializes applications without losing either desired record", async () => {
  await saveManagedDomainConfig(config);
  let active = 0, peak = 0;
  vi.mocked(provider.ensureManagedDomainRoute).mockImplementation(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 25));
    active--; return { action: "created" };
  });
  const results = await Promise.all([ensureManagedAppDomain("9router"), ensureManagedAppDomain("hermes")]);
  expect(results.map(row => row?.phase)).toEqual(["ready", "ready"]);
  expect(peak).toBe(1);
  expect(Object.keys((await readManagedDomains()).apps).sort()).toEqual(["9router", "hermes"]);
});

it("respects manual mode, and exposes corrupt configuration without undoing an app start", async () => {
  expect(await provisionDomainAfterStart("9router")).toEqual({ domain: null, domainDiagnostic: null });
  await saveManagedDomainConfig({ ...config, autoProvision: false });
  expect((await provisionDomainAfterStart("9router")).domain).toBeNull();
  expect(provider.ensureManagedDomainDns).not.toHaveBeenCalled();
  expect((await ensureManagedAppDomain("9router"))?.phase).toBe("ready");
  await fs.writeFile(process.env.OS_MANAGED_DOMAINS_STORE!, "{broken", { mode: 0o600 });
  expect((await provisionDomainAfterStart("9router")).domainDiagnostic).toBeTruthy();
  expect(await fs.readFile(process.env.OS_MANAGED_DOMAINS_STORE!, "utf8")).toBe("{broken");
});
