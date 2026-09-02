import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const productionFiles = [
  "types.ts",
  "classifier.ts",
  "redaction.ts",
  "evidence.ts",
  "repo-memory.ts",
  "repo-memory-storage.ts",
  "repo-memory-artifacts.ts",
  "repo-memory-insights.ts",
  "memory-sync.ts",
  "capability-catalog.mjs",
  "automation.ts",
];

describe("RASMIC standalone invariant", () => {
  it("contains no hard-coded sibling checkout or machine-specific project path", async () => {
    const root = path.resolve(__dirname);
    const source = (await Promise.all(productionFiles.map((name) => fs.readFile(path.join(root, name), "utf8")))).join("\n");
    expect(source).not.toMatch(/\/home\/[^\s"']+\/projects\//);
    expect(source).not.toMatch(/~\/projects\//);
    expect(source).not.toMatch(/\.\.\/\.\.\/\.\.\/projects\//);
  });

  it("keeps repo-local portability rooted in .agent rather than an MSO-private runtime path", async () => {
    const storage = await fs.readFile(path.resolve(__dirname, "repo-memory-storage.ts"), "utf8");
    expect(storage).toContain('path.join(root, ".agent")');
    expect(storage).not.toContain('path.join(root, ".mso")');
  });
});
