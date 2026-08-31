import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("background update notice", () => {
  it("fetches origin/main without mutating FETCH_HEAD", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/mso-update"), "utf8");
    const line = src.split("\n").find((value) => value.includes("nohup git fetch") && value.includes("origin main"));
    expect(line).toContain("--no-write-fetch-head");
  });
});
