import { expect, it, vi } from "vitest";
import { domainProviders, setDomainProviders, type DomainProviderSeam } from "./app-domain-providers";

const fake: DomainProviderSeam = {
  domainProviderCapabilities: () => ({ aRecord: true, cname: true, ingress: false }),
  ensureDomainRecords: vi.fn(async () => ({ action: "updated" as const })),
  inspectDomainRecords: vi.fn(async () => "unchanged" as const),
};

it("fails closed until Contract 1 is wired, then exposes exactly the installed module", () => {
  setDomainProviders(null);
  expect(domainProviders()).toBeNull(); // no Contract 1 -> `provider_unavailable`, never a guess
  setDomainProviders(fake);
  expect(domainProviders()).toBe(fake);
  setDomainProviders(null);
});
