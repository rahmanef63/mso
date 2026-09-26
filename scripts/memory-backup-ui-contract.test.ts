import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("backup browser proof boundary", () => {
  it("checks the actual backup panel rather than a shell ancestor containing unrelated windows", () => {
    const source = readFileSync("frontend/slices/os-settings/components/backup-section.tsx", "utf8");
    const journey = readFileSync("scripts/e2e/memory-backup-history.mjs", "utf8");
    expect(source).toContain('data-slot="backup-settings"');
    expect(journey).toContain(`.include('[data-slot="backup-settings"]')`);
    expect(journey).toContain(".toHaveCount(1)");
    expect(journey).not.toContain(".disableRules(");
  });
  it("records assertion failures and rethrows them instead of reporting an empty success receipt", () => {
    const journey = readFileSync("scripts/e2e/memory-backup-history.mjs", "utf8");
    expect(journey).toContain("passed = false");
    expect(journey).toContain("errors.push(error.stack || String(error))");
    expect(journey).toContain("throw error;");
    expect(journey).toContain("passed, checks, errors, screenshots");
  });
});
