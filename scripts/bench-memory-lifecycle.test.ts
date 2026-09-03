import { describe, expect, it } from "vitest";
import { runMemoryLifecycleCalibration } from "./bench-memory-lifecycle.mjs";

describe("P10 memory lifecycle calibration", () => {
  it("keeps retention, archival history, telemetry, permissions, and frozen-session semantics deterministic", async () => {
    const result = await runMemoryLifecycleCalibration();
    expect(result.accuracyPct).toBe(100);
    expect(result.deterministic).toBe(true);
    expect(result.scenarios.find((row) => row.id === "retention-before-hard-cap")?.pass).toBe(true);
    expect(result.scenarios.find((row) => row.id === "archived-temporal-resolution")?.pass).toBe(true);
    expect(result.scenarios.find((row) => row.id === "privacy-safe-aggregate-telemetry")?.pass).toBe(true);
    expect(result.scenarios.find((row) => row.id === "frozen-session-snapshot")?.pass).toBe(true);
    expect(result.retention.finalLiveRecords).toBeLessThanOrEqual(1000);
    expect(result.retention.archivedRecords).toBeGreaterThan(0);
  });
});
