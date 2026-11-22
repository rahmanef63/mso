import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HELP_LINES, HELP_TEXT, printHelp } from "./mso-agent-help.mjs";

describe("MSO Agent /help command output and regression guard", () => {
  it("printHelp outputs help text without throwing", () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logged.push(String(msg));
    });
    try {
      printHelp();
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join("\n")).toBe(HELP_TEXT);
    } finally {
      spy.mockRestore();
    }
  });

  it("documents every command arm implemented in mso-agent-commands.mjs", () => {
    const commandsPath = path.resolve(__dirname, "mso-agent-commands.mjs");
    const code = fs.readFileSync(commandsPath, "utf8");
    const commandArms = [...code.matchAll(/case\s+"(\/[a-z0-9_-]+)":/g)].map((m) => m[1]);

    expect(commandArms.length).toBeGreaterThanOrEqual(30);

    const help = HELP_TEXT;
    const undocumented = commandArms.filter((cmd) => !help.includes(cmd));
    expect(undocumented).toEqual([]);
  });

  it("contains no em dash characters anywhere in help text", () => {
    expect(HELP_TEXT).not.toContain("\u2014");
    for (const line of HELP_LINES) {
      expect(line).not.toContain("\u2014");
    }
  });

  it("preserves Keyboard section and key bindings", () => {
    expect(HELP_TEXT).toContain("Keyboard");
    expect(HELP_TEXT).toContain("Ctrl+C");
    expect(HELP_TEXT).toContain("Ctrl+D");
    expect(HELP_TEXT).toContain("Ctrl+L");
    expect(HELP_TEXT).toContain("Tab (empty prompt)");
  });

  it("documents new TUI parity commands with honest limitations", () => {
    expect(HELP_TEXT).toContain("/export");
    expect(HELP_TEXT).toContain("/share");
    expect(HELP_TEXT).toMatch(/\/share.*(?:unavailable|download-only)/i);
    expect(HELP_TEXT).toContain("/compact");
    expect(HELP_TEXT).toContain("/reasoning");
    expect(HELP_TEXT).toContain("/reasoning on|off");
    expect(HELP_TEXT).toContain("/theme");
    expect(HELP_TEXT).toContain("/queue");
    expect(HELP_TEXT).toContain("/stash");
    expect(HELP_TEXT).toContain("/stash pop");
    expect(HELP_TEXT).toContain("/image");
    expect(HELP_TEXT).toContain("/diff");
    expect(HELP_TEXT).toContain("/files");
  });
});
