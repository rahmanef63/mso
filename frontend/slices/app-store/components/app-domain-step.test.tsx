import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DOMAIN_POLL_DEADLINE_MS,
  directAddressFrom,
  pollAppDomain,
  providerBlockReason,
  type AppDomainRecord,
} from "../lib/app-domain";
import { DomainEscapeHatch, DomainPhaseSummary, DomainProviderPicker } from "./app-domain-step";

// No DOM renderer is installed here (environment "node", no jsdom or
// @testing-library, and this round may not add a dep), so the step is exercised
// the way this repo already does it: render its pure pieces to static markup,
// and drive the poll loop through its injected clock/fetch seams.

const record = (phase: AppDomainRecord["phase"], extra: Partial<AppDomainRecord> = {}): AppDomainRecord => ({
  appId: "hermes",
  hostname: "hermes.example.com",
  phase,
  provider: "cloudflare",
  updatedAt: 1,
  ...extra,
});

describe("provider picker", () => {
  it("keeps every provider in the list and disables an incapable one with a reason", () => {
    const html = renderToStaticMarkup(<DomainProviderPicker recordType="A" value="cloudflare" onSelect={() => {}}/>);
    for (const label of ["Cloudflare", "Hostinger", "Dokploy", "Custom (you manage DNS)"]) expect(html).toContain(label);
    // Dokploy owns the ingress and writes no DNS without a configured public IP.
    expect(html).toContain("Unavailable: Dokploy owns the ingress");
    expect(html).toMatch(/<input[^>]*disabled[^>]*value="dokploy"/);
    expect(html).not.toMatch(/<input[^>]*disabled[^>]*value="cloudflare"/);
    expect(html).not.toMatch(/<input[^>]*disabled[^>]*value="custom"/);
  });

  it("explains the CNAME case and disables the same providers by capability", () => {
    const html = renderToStaticMarkup(<DomainProviderPicker recordType="CNAME" value={null} onSelect={() => {}}/>);
    expect(html).toContain("record type is CNAME");
    expect(html).toContain("Unavailable: ");
  });

  it("reports capability as a reason instead of dropping the row", () => {
    expect(providerBlockReason("dokploy", "A")).toContain("ingress");
    expect(providerBlockReason("cloudflare", "A")).toBeNull();
    expect(providerBlockReason("hostinger", "CNAME")).toBeNull();
    // `custom` is manual DNS, not an incapable provider.
    expect(providerBlockReason("custom", "A")).toBeNull();
  });
});

describe("wait state", () => {
  const fakeClock = (start = 0) => {
    let clock = start;
    return {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      advanced: () => clock,
    };
  };
  const respond = (body: AppDomainRecord | null, status = 200) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("polls with backoff and hard-stops at the bounded deadline", async () => {
    const clock = fakeClock();
    const calls: number[] = [];
    const outcome = await pollAppDomain({
      appId: "hermes",
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: (async () => { calls.push(clock.now()); return respond(record("pending"))(); }) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("deadline");
    expect(outcome.record?.phase).toBe("pending");
    expect(calls.length).toBeGreaterThan(2);
    expect(clock.advanced()).toBeLessThanOrEqual(DOMAIN_POLL_DEADLINE_MS);
    // Backoff, not a tight loop: the gap between the first and last request grows.
    expect(calls[2] - calls[1]).toBeGreaterThan(calls[1] - calls[0]);
  });

  it("stops as soon as the record settles", async () => {
    const clock = fakeClock();
    let call = 0;
    const outcome = await pollAppDomain({
      appId: "hermes",
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: (async () => respond(record(++call >= 3 ? "ready" : "dns-ready"))()) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("settled");
    expect(outcome.status === "settled" ? outcome.record.phase : null).toBe("ready");
    expect(call).toBe(3);
  });

  it("stops on an aborted signal instead of polling on", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    let call = 0;
    const outcome = await pollAppDomain({
      appId: "hermes",
      signal: controller.signal,
      now: clock.now,
      sleep: async (ms: number) => { clock.now(); controller.abort(); await new Promise<void>(resolve => { void ms; resolve(); }); },
      fetchImpl: (async () => { call++; return respond(record("pending"))(); }) as unknown as typeof fetch,
    });
    expect(outcome.status).toBe("cancelled");
    expect(call).toBe(1);
  });

  it("prints the phase verbatim so the operator can see where it stopped", () => {
    const html = renderToStaticMarkup(<DomainPhaseSummary record={record("route-ready")}/>);
    expect(html).toContain("route-ready");
    expect(html).toContain("hermes.example.com");
  });
});

describe("blocked phase", () => {
  it("renders the blocked reason", () => {
    const html = renderToStaticMarkup(<DomainPhaseSummary record={record("blocked", { error: "Cloudflare refused: zone not found for example.com" })}/>);
    expect(html).toContain("blocked");
    expect(html).toContain("Cloudflare refused: zone not found for example.com");
    expect(html).toMatch(/role="alert"/);
  });
});

describe("IP-and-port escape hatch", () => {
  it("is always present and says it opens a new tab, not an embed", () => {
    const html = renderToStaticMarkup(<DomainEscapeHatch appTitle="Hermes" address="http://192.168.1.10:5678"/>)!;
    expect(html).toContain("Open directly by IP and port instead");
    expect(html).toContain("new browser tab");
    expect(html).toContain("does not embed it");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("stays honest when no IP-and-port address is known", () => {
    const html = renderToStaticMarkup(<DomainEscapeHatch appTitle="Hermes" address="https://hermes.example.com"/>)!;
    expect(html).toContain("Open directly by IP and port instead");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<iframe");
  });

  it("never turns a hostname into a direct address", () => {
    expect(directAddressFrom("https://hermes.example.com")).toBeNull();
    expect(directAddressFrom("http://192.168.1.10:5678")).toBe("http://192.168.1.10:5678");
    expect(directAddressFrom("ftp://192.168.1.10:21")).toBeNull();
    expect(directAddressFrom(null)).toBeNull();
  });
});
