import { expect, it } from "vitest";
import { capabilityReportedFailure } from "./result-outcome";
it("classifies direct/nested MCP errors and failed processes without guessing from ordinary status data", () => {
  for (const result of [{ isError: true, content: [] }, { result: { isError: true } }, { code: 2, stdout: "", stderr: "failed" }]) expect(capabilityReportedFailure(result)).toBe(true);
  for (const result of [{ code: 404 }, { ok: false }, { result: { content: [] } }, null]) expect(capabilityReportedFailure(result)).toBe(false);
});
