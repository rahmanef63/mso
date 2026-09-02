import { describe, expect, test } from "vitest";
import { evaluateComponentResults } from "../../scripts/check-codex-component-results.mjs";

const completeSummary = {
  total: 10,
  completed: 10,
  incomplete: 0,
  failed: 0,
  completeness: "complete",
  deduplication: { status: "completed" },
};

function findings(...levels: string[]) {
  return {
    documentType: "codex-security.component-findings",
    schemaVersion: "1.0",
    findings: levels.map((level) => ({ finding: { severity: { level } }, sources: [] })),
  };
}

describe("Codex Security component result gate", () => {
  test("covers the infrastructure control plane in the committed component plan", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const plan = JSON.parse(fs.readFileSync(path.join(process.cwd(), "security/codex-components.json"), "utf8")) as { components: Array<{ name: string; paths: string[] }> };
    const assigned = new Set(plan.components.flatMap((component) => component.paths));
    expect(assigned).toContain("lib/infra");
    expect(assigned).toContain("lib/orchestration");
    expect(assigned).toContain("frontend/slices/infrastructure");
  });

  test("passes complete coverage with no high-or-critical findings", () => {
    expect(evaluateComponentResults(completeSummary, findings("medium", "low"))).toMatchObject({ exitCode: 0 });
  });

  test("blocks at the configured severity threshold", () => {
    expect(evaluateComponentResults(completeSummary, findings("high"))).toMatchObject({ exitCode: 1 });
    expect(evaluateComponentResults(completeSummary, findings("medium"), "medium")).toMatchObject({ exitCode: 1 });
  });

  test("fails closed for incomplete coverage or matching", () => {
    expect(evaluateComponentResults({ ...completeSummary, completed: 9, incomplete: 1, completeness: "partial" }, findings())).toMatchObject({ exitCode: 2 });
    expect(evaluateComponentResults({ ...completeSummary, deduplication: { status: "incomplete" } }, findings())).toMatchObject({ exitCode: 2 });
  });

  test("fails closed for malformed or unknown severities", () => {
    expect(evaluateComponentResults(completeSummary, findings("unknown"))).toMatchObject({ exitCode: 2 });
    expect(evaluateComponentResults(completeSummary, {})).toMatchObject({ exitCode: 2 });
  });
});
