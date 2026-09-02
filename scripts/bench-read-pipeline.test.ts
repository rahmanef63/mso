import { describe, expect, it } from "vitest";
import { runReadPipelineBenchmark } from "./bench-read-pipeline.mjs";

describe("read_pipeline benchmark", () => {
  it("preserves exact fixture answers while reducing round-trips and model-visible bytes", async () => {
    const result = await runReadPipelineBenchmark();
    expect(result.correctness).toBe(true); expect(result.deterministic).toBe(true);
    expect(result.savings.roundTripReductionPct).toBeGreaterThanOrEqual(75);
    expect(result.savings.modelVisibleByteReductionPct).toBeGreaterThanOrEqual(80);
    expect(result.passed).toBe(true);
  });
});
