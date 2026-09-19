import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("background update notice", () => {
  it("fetches origin/main without mutating FETCH_HEAD through the non-interactive remote policy", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/mso-update"), "utf8");
    const line = src.split("\n").find((value) => value.includes("update_git_fetch_origin") && value.includes("--no-write-fetch-head"));
    expect(line).toContain("main --no-write-fetch-head");
    expect(src).toContain("update-remote-authority.sh");
  });
});
