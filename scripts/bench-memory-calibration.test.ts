import { describe, expect, it } from "vitest";
import { runMemoryCalibration } from "./bench-memory-calibration.mjs";

describe("P9 memory calibration", () => {
  it("keeps repeated corrections, temporal replacement, authority, and forget semantics deterministic", async () => {
    const result = await runMemoryCalibration({ correctionDepth: 12 });
    expect(result).toMatchObject({ calibrationVersion: "mso-memory-calibration-v1", scenarioCount: 6, passed: 6, accuracyPct: 100, deterministic: true, graphMemoryRequiredByCalibration: false });
    expect(result.scenarios.find((row) => row.id === "forget-no-future-resurrection")?.pass).toBe(true);
    expect(result.projection).toMatchObject({ correctionDepth: 12, ledgerRecords: 12, resolvedRecords: 1, finalValue: "Runtime-12" });
    expect(result.projection.projectionReductionPct).toBeGreaterThan(50);
  });
});
