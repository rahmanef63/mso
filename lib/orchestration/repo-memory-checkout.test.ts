import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("RASMIC checkout hygiene", () => {
  it("keeps generated .agent runtime memory from dirtying the MSO source checkout", async () => {
    const ignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore.split(/\r?\n/).map((row) => row.trim())).toContain(".agent/");
  });
});
