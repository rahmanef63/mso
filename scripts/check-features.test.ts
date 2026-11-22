import { describe, expect, it } from "vitest";
import { auditFeatures, parseContractTable } from "./check-features.mjs";

describe("feature contract governance checker", () => {
  it("maps every Svelte feature module on disk to a declarative contract entry", () => {
    const { metrics, details } = auditFeatures();
    expect(details.missingContract).toEqual([]);
    expect(details.orphanContracts).toEqual([]);
    expect(metrics.slicesMissingContract).toBe(0);
    expect(metrics.orphanContractEntries).toBe(0);
  });

  it("parses surfaceKind classifications cleanly from feature-contracts.ts", () => {
    const table = parseContractTable();
    expect(table.get("shell")?.surfaceKind).toBe("shell");
    expect(table.get("integrations")?.surfaceKind).toBe("iframe");
    expect(table.get("workflows")?.surfaceKind).toBe("frame");
  });
});
