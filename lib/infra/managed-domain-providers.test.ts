import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainRecordRequest } from "./managed-domain-providers";

const readInfraProvider = vi.fn();
const listCloudflareZones = vi.fn();
const upsertCloudflareDns = vi.fn();
const inspectCloudflareDns = vi.fn();
const upsertHostingerDns = vi.fn();
const readHostingerZone = vi.fn();
const request = vi.fn();

vi.mock("./store", () => ({ readInfraProvider }));
vi.mock("./cloudflare", () => ({ listCloudflareZones, upsertCloudflareDns, inspectCloudflareDns }));
vi.mock("./hostinger", () => ({ upsertHostingerDns, readHostingerZone }));
// The cast sits on its own const, not on the awaited call: Semgrep's TypeScript
// parser cannot read a generic type argument on `await importOriginal<...>()`,
// and `--strict` turns that parse warning into a failed scan despite 0 findings.
vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal() as typeof import("./http");
  return { ...actual, request };
});

const { domainProviderCapabilities, ensureDomainRecords, inspectDomainRecords } = await import("./managed-domain-providers");
const TOKEN = "synthetic-provider-token-0000000001";
const ZONE = "example.com";
const base: DomainRecordRequest = { provider: "cloudflare", zoneName: ZONE, hostnames: ["app.example.com"], target: { kind: "ipv4", value: "203.0.113.10" } };
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, body, text: JSON.stringify(body) });
const cfRecord = (content: string) => [{ id: "d".repeat(32), name: "app.example.com", type: "A", content, ttl: 1, proxied: false }];

beforeEach(() => {
  vi.resetAllMocks();
  readInfraProvider.mockResolvedValue({ apiToken: TOKEN });
  listCloudflareZones.mockResolvedValue([{ id: "a".repeat(32), name: ZONE }]);
  upsertCloudflareDns.mockResolvedValue({ action: "created", id: "d".repeat(32), name: "app.example.com", type: "A" });
  inspectCloudflareDns.mockResolvedValue([]);
  upsertHostingerDns.mockResolvedValue({ action: "created", name: "app.example.com", type: "A" });
  readHostingerZone.mockResolvedValue({ root: ZONE, name: "app", url: "", rows: [] });
  request.mockImplementation(async (url: string) => url.includes("/portfolio") ? reply([{ domain: ZONE }]) : reply({ success: true, result: [] }));
});

describe("domainProviderCapabilities", () => {
  it("reports ingress only for dokploy and no writes for custom", () => {
    expect(domainProviderCapabilities("cloudflare")).toEqual({ id: "cloudflare", aRecord: true, cname: true, txt: true, ingress: false });
    expect(domainProviderCapabilities("hostinger")).toEqual({ id: "hostinger", aRecord: true, cname: true, txt: true, ingress: false });
    expect(domainProviderCapabilities("dokploy")).toEqual({ id: "dokploy", aRecord: true, cname: false, txt: false, ingress: true });
    expect(domainProviderCapabilities("custom")).toEqual({ id: "custom", aRecord: false, cname: false, txt: false, ingress: false });
  });
  it("rejects an unknown provider id instead of inventing a capability", () => {
    expect(() => domainProviderCapabilities("route53" as never)).toThrow("unknown domain provider");
  });
});

describe("custom provider", () => {
  it("never writes and reports unchanged so the caller can surface manual instructions", async () => {
    expect(await ensureDomainRecords({ ...base, provider: "custom" })).toEqual({ provider: "custom", action: "unchanged", records: [{ hostname: "app.example.com", type: "A" }] });
    expect(await inspectDomainRecords({ ...base, provider: "custom" })).toBe("unchanged");
    expect(readInfraProvider).not.toHaveBeenCalled();
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
});

describe("cloudflare provider", () => {
  it("delegates every hostname to the existing upsert helper", async () => {
    upsertCloudflareDns.mockResolvedValue({ action: "updated", id: "d".repeat(32), name: "app.example.com", type: "A" });
    const result = await ensureDomainRecords({ ...base, hostnames: ["app.example.com", "api.example.com"] });
    expect(upsertCloudflareDns).toHaveBeenCalledWith({ name: "app.example.com", type: "A", content: "203.0.113.10" });
    expect(upsertCloudflareDns).toHaveBeenCalledWith({ name: "api.example.com", type: "A", content: "203.0.113.10" });
    expect(result.action).toBe("updated");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({ hostname: "app.example.com", type: "A", recordId: "d".repeat(32) });
  });
  it("inspects through the read-only helper and compares the target without writing", async () => {
    expect(await inspectDomainRecords(base)).toBe("created");
    inspectCloudflareDns.mockResolvedValue(cfRecord("203.0.113.10"));
    expect(await inspectDomainRecords(base)).toBe("unchanged");
    inspectCloudflareDns.mockResolvedValue(cfRecord("198.51.100.1"));
    expect(await inspectDomainRecords(base)).toBe("updated");
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("propagates the pinned-zone rejection from the Cloudflare helper", async () => {
    upsertCloudflareDns.mockRejectedValue(new Error("configured Cloudflare zoneId is not accessible to this token"));
    await expect(ensureDomainRecords(base)).rejects.toThrow("zoneId is not accessible");
  });
});

describe("hostinger provider", () => {
  it("delegates validation and ambiguity to upsertHostingerDns", async () => {
    expect(await ensureDomainRecords({ ...base, provider: "hostinger" })).toEqual({ provider: "hostinger", action: "created", records: [{ hostname: "app.example.com", type: "A" }] });
    expect(upsertHostingerDns).toHaveBeenCalledWith({ name: "app.example.com", type: "A", content: "203.0.113.10" });
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
  });
  it("inspects zone rows relative to the portfolio apex and rejects a foreign apex", async () => {
    readHostingerZone.mockResolvedValue({ root: ZONE, name: "app", url: "", rows: [{ name: "app", type: "A", records: [{ content: "203.0.113.10" }] }] });
    expect(await inspectDomainRecords({ ...base, provider: "hostinger" })).toBe("unchanged");
    readHostingerZone.mockResolvedValue({ root: ZONE, name: "app", url: "", rows: [{ name: "app", type: "A", records: [{ content: "198.51.100.1" }] }] });
    expect(await inspectDomainRecords({ ...base, provider: "hostinger" })).toBe("updated");
    readHostingerZone.mockResolvedValue({ root: ZONE, name: "@", url: "", rows: [] });
    expect(await inspectDomainRecords({ ...base, provider: "hostinger", hostnames: [ZONE] })).toBe("created");
    readHostingerZone.mockResolvedValue({ root: "other.test", name: "@", url: "", rows: [] });
    await expect(inspectDomainRecords({ ...base, provider: "hostinger" })).rejects.toThrow("outside zone");
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("propagates a portfolio rejection from the Hostinger helper before any write", async () => {
    upsertHostingerDns.mockRejectedValue(new Error("app.example.com is not in the Hostinger domain portfolio"));
    await expect(ensureDomainRecords({ ...base, provider: "hostinger" })).rejects.toThrow("not in the Hostinger domain portfolio");
  });
});

describe("dokploy provider", () => {
  const dokploy = { apiUrl: "https://panel.example.com/api", apiKey: "k".repeat(32), publicIp: "203.0.113.10" };

  it("writes A records through the Cloudflare zone owner when publicIp is configured", async () => {
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? dokploy : id === "cloudflare" ? { apiToken: TOKEN } : {});
    expect(await ensureDomainRecords({ ...base, provider: "dokploy" })).toMatchObject({ provider: "dokploy", action: "created" });
    expect(upsertCloudflareDns).toHaveBeenCalledWith({ name: "app.example.com", type: "A", content: "203.0.113.10" });
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("writes through Hostinger when only Hostinger owns the zone", async () => {
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? dokploy : id === "hostinger" ? { apiToken: TOKEN } : {});
    await ensureDomainRecords({ ...base, provider: "dokploy" });
    expect(upsertHostingerDns).toHaveBeenCalledWith({ name: "app.example.com", type: "A", content: "203.0.113.10" });
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
  });
  it("fails closed without publicIp or with a target that differs from it", async () => {
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? { apiUrl: dokploy.apiUrl, apiKey: dokploy.apiKey } : { apiToken: TOKEN });
    await expect(ensureDomainRecords({ ...base, provider: "dokploy" })).rejects.toThrow("no publicIp configured");
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? dokploy : { apiToken: TOKEN });
    await expect(ensureDomainRecords({ ...base, provider: "dokploy", target: { kind: "ipv4", value: "203.0.113.99" } })).rejects.toThrow("must equal the configured publicIp");
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
  });
  it("fails closed when no zone provider is configured", async () => {
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? dokploy : {});
    await expect(ensureDomainRecords({ ...base, provider: "dokploy" })).rejects.toThrow("Dokploy cannot write DNS for example.com");
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("rejects ambiguous zone ownership across Cloudflare and Hostinger", async () => {
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? dokploy : { apiToken: TOKEN });
    await expect(ensureDomainRecords({ ...base, provider: "dokploy" })).rejects.toThrow("ambiguous DNS ownership");
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("refuses a CNAME because Dokploy ingress publishes A records only", async () => {
    readInfraProvider.mockImplementation(async (id: string) => id === "dokploy" ? dokploy : { apiToken: TOKEN });
    await expect(ensureDomainRecords({ ...base, provider: "dokploy", target: { kind: "cname", value: "edge.example.net" } })).rejects.toThrow("A records only");
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
  });
});

describe("missing credentials and ambiguity", () => {
  it.each(["cloudflare", "hostinger"] as const)("rejects %s without a token and writes nothing", async (provider) => {
    readInfraProvider.mockResolvedValue({});
    await expect(ensureDomainRecords({ ...base, provider })).rejects.toThrow("is not configured");
    await expect(inspectDomainRecords({ ...base, provider })).rejects.toThrow("is not configured");
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("rejects missing Dokploy credentials before resolving a zone writer", async () => {
    readInfraProvider.mockResolvedValue({});
    await expect(ensureDomainRecords({ ...base, provider: "dokploy" })).rejects.toThrow("Dokploy is not configured");
    expect(listCloudflareZones).not.toHaveBeenCalled();
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
  });
  it("rejects two candidate records for one name instead of first-match", async () => {
    inspectCloudflareDns.mockRejectedValue(new Error("refusing ambiguous DNS change: 2 A records already exist for app.example.com"));
    await expect(inspectDomainRecords(base)).rejects.toThrow("refusing ambiguous DNS change: 2 A records");
    readHostingerZone.mockResolvedValue({ root: ZONE, name: "app", url: "", rows: [{ name: "app", type: "A", records: [{ content: "203.0.113.10" }] }, { name: "app", type: "A", records: [{ content: "203.0.113.11" }] }] });
    await expect(inspectDomainRecords({ ...base, provider: "hostinger" })).rejects.toThrow("refusing ambiguous DNS change: 2 A rows");
    upsertHostingerDns.mockRejectedValue(new Error("refusing ambiguous Hostinger DNS change: 2 A rows exist for app.example.com"));
    await expect(ensureDomainRecords({ ...base, provider: "hostinger" })).rejects.toThrow("ambiguous");
  });
});

describe("redaction", () => {
  it("never lets credential material reach a thrown error, on write or inspection", async () => {
    upsertCloudflareDns.mockRejectedValue(new Error(`Cloudflare DNS POST HTTP 403 for Authorization: Bearer ${TOKEN}`));
    const write = await ensureDomainRecords(base).catch((caught: Error) => caught);
    expect(write).toBeInstanceOf(Error);
    expect(String(write)).not.toContain(TOKEN);
    expect(String(write)).toContain("[redacted]");
    inspectCloudflareDns.mockRejectedValue(new Error(`lookup failed with token ${TOKEN}`));
    expect(String(await inspectDomainRecords(base).catch((caught: Error) => caught))).not.toContain(TOKEN);
  });
});

describe("request validation", () => {
  it.each([
    [{ hostnames: ["app.other.test"] }, "outside zone"],
    [{ target: { kind: "ipv4", value: "not-an-ip" } }, "IPv4"],
    [{ target: { kind: "ipv4", value: "2001:db8::1" } }, "IPv4"],
    [{ target: { kind: "cname", value: "not a host" } }, "CNAME target"],
    [{ hostnames: [] }, "at least one hostname"],
    [{ provider: "route53" }, "unknown domain provider"],
    [{ zoneName: "not a zone" }, "invalid zone name"],
  ] as const)("rejects invalid input %#", async (patch, message) => {
    await expect(ensureDomainRecords({ ...base, ...(patch as object) } as DomainRecordRequest)).rejects.toThrow(message);
    expect(upsertCloudflareDns).not.toHaveBeenCalled();
    expect(upsertHostingerDns).not.toHaveBeenCalled();
  });
  it("normalizes case and a trailing dot, de-duplicates, and normalizes a CNAME target", async () => {
    await ensureDomainRecords({ ...base, zoneName: "Example.COM.", hostnames: ["App.Example.com.", "app.example.com"] });
    expect(upsertCloudflareDns).toHaveBeenCalledTimes(1);
    expect(upsertCloudflareDns).toHaveBeenCalledWith({ name: "app.example.com", type: "A", content: "203.0.113.10" });
    await ensureDomainRecords({ ...base, target: { kind: "cname", value: "Edge.Example.NET." } });
    expect(upsertCloudflareDns).toHaveBeenLastCalledWith({ name: "app.example.com", type: "CNAME", content: "edge.example.net" });
  });
});
