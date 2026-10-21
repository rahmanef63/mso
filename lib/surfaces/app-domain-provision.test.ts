import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppDomainError, ensureShellAppDomain, inspectShellAppDomain } from "./app-domain-provision";
import { setDomainProviders, type DomainProviderSeam } from "./app-domain-providers";

const app = {
  id: "private-editor", title: "Editor", description: "", origin: "https://editor.example.net", startPath: "/",
  renderer: "iframe", presentation: "inline", environment: "production", placements: ["shell"],
  sessionUpstream: "http://127.0.0.1:9131",
} as const;
const provider = (overrides: Partial<DomainProviderSeam> = {}): DomainProviderSeam => ({
  domainProviderCapabilities: () => ({ aRecord: true, cname: true, ingress: false }),
  ensureDomainRecords: vi.fn(async () => ({ action: "created" as const })),
  inspectDomainRecords: vi.fn(async () => "unchanged" as const),
  ...overrides,
});
let directory: string;
const store = () => path.join(directory, "shell-app-domains.json");

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-app-domain-"));
  vi.stubEnv("OS_SHELL_APP_DOMAINS_STORE", store());
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app]));
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302 })));
  setDomainProviders(provider());
});
afterEach(async () => {
  setDomainProviders(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(directory, { recursive: true, force: true });
});

it("probes loopback before writing DNS and only reports ready after verification", async () => {
  const providers = provider({
    ensureDomainRecords: vi.fn(async () => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      expect(await inspectShellAppDomain(app.id)).toMatchObject({ phase: "pending", localOrigin: "http://127.0.0.1:9131" });
      return { action: "created" as const };
    }),
    inspectDomainRecords: vi.fn(async () => {
      expect(await inspectShellAppDomain(app.id)).toMatchObject({ phase: "route-ready", dnsAction: "created" });
      return "unchanged" as const;
    }),
  });
  setDomainProviders(providers);
  const record = await ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } });
  expect(record).toMatchObject({ appId: app.id, hostname: "editor.example.net", phase: "ready", provider: "cloudflare",
    dnsAction: "created", routeAction: "unchanged", localOrigin: "http://127.0.0.1:9131", verifiedAt: expect.any(Number) });
  expect(record.error).toBeUndefined();
  expect(vi.mocked(providers.ensureDomainRecords).mock.calls[0][0]).toEqual({
    provider: "cloudflare", zoneName: "example.net", hostnames: ["editor.example.net"], target: { kind: "ipv4", value: "203.0.113.10" },
  });
  const stat = await fs.stat(store());
  expect(stat.mode & 0o777).toBe(0o600);
  expect(stat.uid).toBe(process.getuid?.());
  expect(JSON.parse(await fs.readFile(store(), "utf8"))).toMatchObject({ version: 1, revision: 4 });
});

it("publishes no DNS and no route when the loopback origin is not serving the app", async () => {
  const providers = provider();
  setDomainProviders(providers);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 502 }));
  const record = await ensureShellAppDomain(app.id, { provider: "hostinger", hostname: "editor.example.net", target: { kind: "cname", value: "origin.example.net" } });
  expect(record.phase).toBe("blocked");
  expect(record.error).toContain("does not serve shell app");
  expect(record.verifiedAt).toBeUndefined();
  expect(providers.ensureDomainRecords).not.toHaveBeenCalled();
  expect(providers.inspectDomainRecords).not.toHaveBeenCalled();
});

it("resumes at the reached phase instead of repeating the DNS write or the probe", async () => {
  const first = provider({
    ensureDomainRecords: vi.fn(async () => ({ action: "created" as const })),
    inspectDomainRecords: vi.fn(async () => "created" as const),
  });
  setDomainProviders(first);
  const interrupted = await ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } });
  expect(interrupted).toMatchObject({ phase: "blocked", dnsAction: "created", routeAction: "unchanged" });
  expect(interrupted.error).toContain("DNS verification pending");

  vi.mocked(fetch).mockClear();
  const second = provider({ inspectDomainRecords: vi.fn(async () => "unchanged" as const) });
  setDomainProviders(second);
  const resumed = await ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } });
  expect(resumed.phase).toBe("ready");
  expect(second.ensureDomainRecords).not.toHaveBeenCalled();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  expect(second.inspectDomainRecords).toHaveBeenCalledTimes(1);
});

it("never reports a blocked record ready on a later inspect", async () => {
  setDomainProviders(provider({ ensureDomainRecords: vi.fn(async () => { throw new Error("Cloudflare HTTP 403"); }) }));
  expect((await ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } })).phase).toBe("blocked");
  expect(await inspectShellAppDomain(app.id)).toMatchObject({ phase: "blocked", error: "Cloudflare HTTP 403" });
});

it("surfaces manual instructions for the custom provider and does not fabricate ready", async () => {
  setDomainProviders(provider());
  const record = await ensureShellAppDomain(app.id, { provider: "custom", hostname: "editor.example.net", target: { kind: "cname", value: "origin.example.net" } });
  expect(record.phase).toBe("blocked");
  expect(record.error).toContain("create CNAME editor.example.net -> origin.example.net");
});

it.each([
  ["the cockpit hostname", "mso.example.com"],
  ["a cockpit subdomain", "admin.mso.example.com"],
  ["a cockpit parent", "com.example"],
  ["an uppercase name", "Editor.example.net"],
  ["an IPv4 literal", "203.0.113.10"],
  ["a single label", "editor"],
  ["a trailing dot", "editor.example.net."],
])("rejects %s with a precise error and writes nothing", async (_label, hostname) => {
  const providers = provider();
  setDomainProviders(providers);
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname, target: { kind: "ipv4", value: "203.0.113.10" } }))
    .rejects.toMatchObject({ code: "invalid_hostname", status: 400 });
  expect(providers.ensureDomainRecords).not.toHaveBeenCalled();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  await expect(fs.stat(store())).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects a name inside OS_SESSION_COOKIE_DOMAIN instead of widening the session", async () => {
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", ".apps.example.net");
  setDomainProviders(provider());
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.apps.example.net", target: { kind: "ipv4", value: "203.0.113.10" } }))
    .rejects.toThrow(/OS_SESSION_COOKIE_DOMAIN apps\.example\.net/);
});

it("refuses a hostname another shell app already owns", async () => {
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app, { ...app, id: "second-app", origin: "https://second.example.net" }]));
  setDomainProviders(provider());
  await ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } });
  await expect(ensureShellAppDomain("second-app", { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } }))
    .rejects.toMatchObject({ code: "domain_conflict", status: 409 });
  expect((await inspectShellAppDomain("second-app"))).toBeNull();
});

it("rejects unknown providers, invalid targets, foreign zones, and unknown apps before any probe", async () => {
  const providers = provider();
  setDomainProviders(providers);
  const target = { kind: "ipv4" as const, value: "203.0.113.10" };
  await expect(ensureShellAppDomain(app.id, { provider: "route53" as never, hostname: "editor.example.net", target })).rejects.toMatchObject({ code: "unsupported_provider" });
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "not-an-ip" } })).rejects.toMatchObject({ code: "invalid_target" });
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target, zoneName: "other.test" })).rejects.toThrow(/outside zone other\.test/);
  await expect(ensureShellAppDomain("missing-app", { provider: "cloudflare", hostname: "editor.example.net", target })).rejects.toMatchObject({ code: "app_not_found", status: 404 });
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  expect(providers.ensureDomainRecords).not.toHaveBeenCalled();
});

it("fails closed when the provider cannot write the required record type or the module is absent", async () => {
  setDomainProviders(provider({ domainProviderCapabilities: () => ({ aRecord: true, cname: false, ingress: true }) }));
  await expect(ensureShellAppDomain(app.id, { provider: "dokploy", hostname: "editor.example.net", target: { kind: "cname", value: "origin.example.net" } }))
    .rejects.toMatchObject({ code: "unsupported_provider" });
  setDomainProviders(null);
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } }))
    .rejects.toMatchObject({ code: "provider_unavailable", status: 503 });
});

it("refuses an app with no loopback origin and refuses to reset corrupted state", async () => {
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, origin: "https://editor.example.net", sessionUpstream: undefined }]));
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } }))
    .rejects.toThrow(/no loopback origin/);
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app]));
  await fs.writeFile(store(), "{broken", { mode: 0o600 });
  await expect(ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } })).rejects.toThrow();
  await expect(inspectShellAppDomain(app.id)).rejects.toThrow();
  expect(await fs.readFile(store(), "utf8")).toBe("{broken");
});

it("refuses a group-readable state file without repairing it", async () => {
  setDomainProviders(provider());
  await ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } });
  await fs.chmod(store(), 0o644);
  await expect(inspectShellAppDomain(app.id)).rejects.toThrow(/unsafe shell-app domain state file/);
  expect((await fs.stat(store())).mode & 0o777).toBe(0o644);
});

it("serializes concurrent provisioning of two apps without losing either record", async () => {
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app, { ...app, id: "second-app", origin: "https://second.example.net" }]));
  let active = 0, peak = 0;
  setDomainProviders(provider({ inspectDomainRecords: vi.fn(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--; return "unchanged" as const;
  }) }));
  const results = await Promise.all([
    ensureShellAppDomain(app.id, { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } }),
    ensureShellAppDomain("second-app", { provider: "cloudflare", hostname: "second.example.net", target: { kind: "ipv4", value: "203.0.113.11" } }),
  ]);
  expect(results.map(row => row.phase)).toEqual(["ready", "ready"]);
  expect(peak).toBe(1);
  expect((await inspectShellAppDomain(app.id))?.hostname).toBe("editor.example.net");
  expect((await inspectShellAppDomain("second-app"))?.hostname).toBe("second.example.net");
});

it("exposes an AppDomainError carrying the contract error code", async () => {
  const error = new AppDomainError("domain_conflict", 409, "taken");
  expect(error).toMatchObject({ name: "AppDomainError", code: "domain_conflict", status: 409, message: "taken" });
});
