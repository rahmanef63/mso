import { expect, it } from "vitest";
import {
  DOMAIN_PROVIDER_IDS as SERVER_PROVIDER_IDS,
  type AppDomainRecord as ServerRecord,
  type DomainProviderCapability as ServerCapability,
} from "@/lib/contracts/app-domain";
import {
  DOMAIN_PROVIDER_IDS as MIRROR_PROVIDER_IDS,
  type AppDomainRecord as MirrorRecord,
  type DomainProviderCapability as MirrorCapability,
} from "./app-domain";

// The browser copy in `./app-domain.ts` cannot import the server contract, so this
// is the check that keeps it a mirror rather than a fork. Field NAMES only: the
// compiler already proves assignability; this proves neither side renamed a field.
const fields = (shape: Record<string, unknown>) => Object.keys(shape).sort();

it("mirrors the provider union in the same order", () => {
  expect([...MIRROR_PROVIDER_IDS]).toEqual([...SERVER_PROVIDER_IDS]);
});

it("mirrors every record and capability field name", () => {
  const record: MirrorRecord = { appId: "", hostname: "", phase: "ready", provider: "custom", dnsAction: "unchanged",
    routeAction: "unchanged", error: "", localOrigin: "", verifiedAt: 0, updatedAt: 0 };
  const capability: MirrorCapability = { id: "custom", aRecord: false, cname: false, txt: false, ingress: false };
  expect(Object.keys(record satisfies ServerRecord).sort()).toEqual(fields(record));
  expect(Object.keys(capability satisfies ServerCapability).sort()).toEqual(fields(capability));
  expect(fields(record)).toEqual(["appId", "dnsAction", "error", "hostname", "localOrigin", "phase", "provider", "routeAction", "updatedAt", "verifiedAt"]);
  expect(fields(capability)).toEqual(["aRecord", "cname", "id", "ingress", "txt"]);
});
