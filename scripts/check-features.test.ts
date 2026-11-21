import { describe, expect, it } from "vitest";
import { auditFeatures, parseContractTable } from "./check-features.mjs";

describe("feature contract governance checker", () => {
  it("maps every slice on disk to a declarative contract entry", () => {
    const { metrics, details } = auditFeatures();
    expect(details.missingContract).toEqual([]);
    expect(details.orphanContracts).toEqual([]);
    expect(metrics.slicesMissingContract).toBe(0);
    expect(metrics.orphanContractEntries).toBe(0);
    expect(metrics.slicesWithoutBarrel).toBe(0);
  });

  it("requires colocated unit tests for every slice", () => {
    const { metrics, details } = auditFeatures();
    expect(details.withoutTests).toEqual([]);
    expect(metrics.slicesWithoutTests).toBe(0);
  });

  it("parses surfaceKind classifications cleanly from feature-contracts.ts", () => {
    const table = parseContractTable();
    expect(table.get("appshell")?.surfaceKind).toBe("shell");
    expect(table.get("integrations")?.surfaceKind).toBe("iframe");
    expect(table.get("workflows")?.surfaceKind).toBe("frame");
  });
});
