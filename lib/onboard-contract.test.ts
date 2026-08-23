import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = fs.readFileSync(path.join(__dirname, "../bin/mso"), "utf8");

describe("terminal onboarding contract", () => {
  it("keeps API keys out of curl argv", () => {
    expect(cli).toContain('tty_secret "Paste $provider API key: "');
    expect(cli).toContain("stty -echo < /dev/tty");
    const start = cli.indexOf("secret_post() {");
    const end = cli.indexOf("\n}\n\ntty_ok()", start);
    const secretPost = cli.slice(start, end);
    expect(secretPost).toContain("-d @-");
    expect(secretPost).toContain('printf \'%s\' "$body" | curl');
    expect(secretPost).not.toContain('-d "$body"');
    expect(cli).toContain('secret_post "/api/config" "$body"');
  });

  it("documents OAuth separately from API-key providers", () => {
    expect(cli).toContain("OpenAI ChatGPT OAuth (Codex consumer backend; no API key)");
    expect(cli).toContain("OpenRouter API key");
    expect(cli).toContain("OpenAI Platform API key");
  });

  it("keeps -y minimal instead of selecting external accounts or installs", () => {
    expect(cli).toContain("AI provider skipped (-y keeps external accounts unconfigured)");
    expect(cli).toContain("response preset left unchanged (-y keeps existing/default settings)");
    expect(cli).toContain("optional managed apps skipped (-y uses minimal defaults)");
    expect(cli).toContain("none installed automatically; run: mso skills install ponytail caveman rtk -y");
  });
});
