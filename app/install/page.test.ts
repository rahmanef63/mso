import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");

describe("public install guide", () => {
  it("documents the terminal onboarding that the one-line installer actually runs", () => {
    expect(source).toContain("Complete terminal onboarding");
    expect(source).toContain("mso onboard");
    expect(source).toContain("OpenAI ChatGPT OAuth");
    expect(source).toContain("OpenRouter");
  });

  it("documents an immediately resolvable CLI and the curated skill market", () => {
    expect(source).toContain("/usr/local/bin/mso");
    expect(source).toContain("mso -h");
    expect(source).toContain("mso skills available");
    expect(source).toContain("mso skills install ponytail caveman rtk -y");
  });

  it("gives AI agents one canonical install/update path including legacy upgrades", () => {
    expect(source).toContain("Install or update MSO from this repo");
    expect(source).toContain("mso update");
    expect(source).toContain("Settings → About");
    expect(source).toContain("older build");
    expect(source).toContain("preserves existing configuration/state");
  });

});
