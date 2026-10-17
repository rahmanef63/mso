import { describe, expect, it, vi } from "vitest";
import type { ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { inspectManagedDomainDns, reconcileManagedDomainDns } from "./managed-domain-dns";

const input: ManagedDomainRoute = {
  hostname: "9router.example.com", cockpitHostname: "mso.example.com", localOrigin: "http://127.0.0.1:4005",
  zoneId: "a".repeat(32), zoneName: "example.com", accountId: "b".repeat(32),
  tunnelId: "11111111-2222-3333-4444-555555555555", ownerTag: "mso:owner:9router",
};
const recordId = "d".repeat(32);
const desired = { id: recordId, type: "CNAME", name: input.hostname,
  content: `${input.tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1, comment: input.ownerTag };

function fixture(initial: Record<string, unknown>[] = []) {
  let records = structuredClone(initial);
  let pages = 1, loseWriteResponse = false, refuseWrite = false;
  const call = vi.fn(async (_resource: string, _label: string, init: RequestInit = {}) => {
    if (!init.method) return { result: structuredClone(records), result_info: { total_pages: pages } };
    if (refuseWrite) throw new Error("Cloudflare DNS POST HTTP 403");
    records = [{ ...records[0], id: recordId, ...JSON.parse(String(init.body)) }];
    if (loseWriteResponse) throw new Error("network response lost");
    return { result: structuredClone(records[0]) };
  });
  return { client: { call, tunnelPath: "/unused" }, call, get records() { return records; },
    setPages(value: number) { pages = value; }, loseResponse() { loseWriteResponse = true; }, denyWrite() { refuseWrite = true; } };
}

describe("managed domain DNS ownership and retries", () => {
  it("creates one owned proxied CNAME and repeated ensure performs no extra write", async () => {
    const f = fixture();
    expect(await reconcileManagedDomainDns(f.client, input)).toEqual({ id: recordId, action: "created" });
    expect(await reconcileManagedDomainDns(f.client, input)).toEqual({ id: recordId, action: "unchanged" });
    expect(f.records).toEqual([desired]);
    expect(f.call.mock.calls.filter(([, , init]) => init?.method)).toHaveLength(1);
    expect(f.call.mock.calls[0][0]).toContain("?name.exact=9router.example.com&per_page=100");
    expect(f.call.mock.calls[0][0]).not.toContain("type=CNAME");
  });

  it("reuses an exact existing foreign CNAME without claiming ownership", async () => {
    const f = fixture([{ ...desired, comment: "managed elsewhere", content: `${desired.content}.` }]);
    await expect(reconcileManagedDomainDns(f.client, input)).resolves.toEqual({ id: recordId, action: "unchanged" });
    expect(f.records[0].comment).toBe("managed elsewhere");
    expect(f.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
  });

  it.each([
    { ...desired, type: "A", content: "192.0.2.1" },
    { ...desired, type: "TXT", content: "already occupied" },
    { ...desired, content: "foreign.example.net", comment: "someone else" },
    { ...desired, proxied: false, comment: undefined },
  ])("refuses occupied or foreign DNS settings without mutation", async record => {
    const f = fixture([record]);
    await expect(inspectManagedDomainDns(f.client, input)).rejects.toThrow("DNS conflict");
    await expect(reconcileManagedDomainDns(f.client, input)).rejects.toThrow("DNS conflict");
    expect(f.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
  });

  it("updates only this app's owned CNAME and preserves unrelated record fields", async () => {
    const f = fixture([{ ...desired, content: "old.cfargotunnel.com", proxied: false, tags: ["retained:yes"] }]);
    await expect(reconcileManagedDomainDns(f.client, input)).resolves.toEqual({ id: recordId, action: "updated" });
    expect(f.records[0]).toEqual({ ...desired, tags: ["retained:yes"] });
    const mutation = f.call.mock.calls.find(([, , init]) => init?.method);
    expect(mutation?.[0].endsWith(`/${recordId}`)).toBe(true);
    expect(mutation?.[2]?.method).toBe("PATCH");
  });

  it("recovers an acknowledged-late POST by rereading instead of posting again", async () => {
    const f = fixture(); f.loseResponse();
    await expect(reconcileManagedDomainDns(f.client, input)).resolves.toEqual({ id: recordId, action: "unchanged" });
    expect(f.call.mock.calls.filter(([, , init]) => init?.method)).toHaveLength(1);
  });

  it("propagates failed writes when the desired owned record was not created", async () => {
    const f = fixture(); f.denyWrite();
    await expect(reconcileManagedDomainDns(f.client, input)).rejects.toThrow("HTTP 403");
    expect(f.records).toEqual([]);
  });

  it("rejects duplicate and incomplete lookup results before any mutation", async () => {
    const duplicate = fixture([desired, { ...desired, id: "another" }]);
    await expect(reconcileManagedDomainDns(duplicate.client, input)).rejects.toThrow("multiple records");
    const truncated = fixture(); truncated.setPages(2);
    await expect(reconcileManagedDomainDns(truncated.client, input)).rejects.toThrow("incomplete");
    expect([...duplicate.call.mock.calls, ...truncated.call.mock.calls].every(([, , init]) => !init?.method)).toBe(true);
  });

  it("rejects malformed provider IDs before they can enter durable state", async () => {
    const f = fixture([{ ...desired, id: "not-a-cloudflare-id" }]);
    await expect(reconcileManagedDomainDns(f.client, input)).rejects.toThrow("identifier");
    expect(f.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
  });
});
