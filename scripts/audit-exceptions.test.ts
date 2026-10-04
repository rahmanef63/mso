import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRACES_DEV_LINT, bracesDevLintAllows, readRepoLock } from "./audit-exceptions.mjs";

const IDS = [BRACES_DEV_LINT.id, BRACES_DEV_LINT.cve];
const OPEN = new Date("2026-10-04T00:00:00Z");
const EXPIRED = new Date(BRACES_DEV_LINT.until);
type Deps = Record<string, string>;
type Lock = {
  workspaces: { "": { dependencies: Deps; devDependencies: Deps } };
  packages: Record<string, [string, string, { dependencies: Deps }]>;
};

function lock(mutate: (row: Lock) => void = () => {}) {
  const row: Lock = {
    workspaces: { "": { dependencies: { next: "1" }, devDependencies: { "eslint-config-next": "1" } } },
    packages: {
      braces: ["braces@3.0.3", "", { dependencies: {} }],
      micromatch: ["micromatch@4.0.8", "", { dependencies: { braces: "^3.0.3" } }],
      "fast-glob": ["fast-glob@3.3.1", "", { dependencies: { micromatch: "^4.0.4" } }],
      "@next/eslint-plugin-next": ["@next/eslint-plugin-next@16.3.8", "", { dependencies: { "fast-glob": "3.3.1" } }],
      "eslint-config-next": ["eslint-config-next@16.3.8", "", { dependencies: { "@next/eslint-plugin-next": "16.3.8" } }],
    },
  };
  mutate(row);
  return JSON.stringify(row);
}

describe("braces dev-lint exception", () => {
  it("allows only the named GHSA while the dev chain and date still match", () => {
    expect(bracesDevLintAllows("braces", IDS, lock(), OPEN)).toBe(true);
    expect(bracesDevLintAllows("braces", IDS, readRepoLock(), OPEN)).toBe(true);
  });
  it("refuses another package, a missing GHSA, expiry, a second parent, or a production edge", () => {
    expect(bracesDevLintAllows("micromatch", IDS, lock(), OPEN)).toBe(false);
    expect(bracesDevLintAllows("braces", ["CVE-2026-93687"], lock(), OPEN)).toBe(false);
    expect(bracesDevLintAllows("braces", IDS, lock(), EXPIRED)).toBe(false);
    const extra = lock((row) => { row.packages.other = ["other@1.0.0", "", { dependencies: { braces: "3.0.3" } }]; });
    expect(bracesDevLintAllows("braces", IDS, extra, OPEN)).toBe(false);
    const prod = lock((row) => { row.workspaces[""].dependencies["eslint-config-next"] = "1"; });
    expect(bracesDevLintAllows("braces", IDS, prod, OPEN)).toBe(false);
    const bumped = lock((row) => { row.packages.braces[0] = "braces@3.0.4"; });
    expect(bracesDevLintAllows("braces", IDS, bumped, OPEN)).toBe(false);
  });
  it("keeps the OSV ignore on the same GHSA, instant, and reason", () => {
    const toml = readFileSync(new URL("../osv-scanner.toml", import.meta.url), "utf8");
    expect(toml).toContain(`id = "${BRACES_DEV_LINT.id}"`);
    expect(toml).toContain(`ignoreUntil = ${BRACES_DEV_LINT.until}`);
    expect(toml).toContain(`reason = "${BRACES_DEV_LINT.reason}"`);
    expect(toml).not.toContain("GHSA-ch52-4w7c-c8xp");
  });
});
