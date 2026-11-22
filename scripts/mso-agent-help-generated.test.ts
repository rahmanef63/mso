import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_LINES, HELP_TEXT, helpLines } from "./mso-agent-help.mjs";
import { COMMAND_MANIFEST } from "./mso-agent-commands.mjs";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";

describe("MSO Agent dynamically generated help text", () => {
  it("(1) every command in dispatch table appears in help output, derived not hardcoded", () => {
    // Read dispatch table arms from mso-agent-commands.mjs source of truth
    const commandsPath = path.resolve(__dirname, "mso-agent-commands.mjs");
    const code = fs.readFileSync(commandsPath, "utf8");
    const commandArms = [...code.matchAll(/case\s+"(\/[a-z0-9_-]+)":/g)].map((m) => m[1]);

    expect(commandArms.length).toBeGreaterThanOrEqual(30);

    const help = helpLines({ commands: COMMAND_MANIFEST }).join("\n");
    const undocumented = commandArms.filter((cmd) => !help.includes(cmd));
    expect(undocumented).toEqual([]);

    // Derived proof: passing a synthetic command manifest generates only that command
    const synthetic = [{ name: "/test-synthetic-xyz", description: "testing synthetic derivation" }];
    const derivedText = helpLines({ commands: synthetic }).join("\n");
    expect(derivedText).toContain("/test-synthetic-xyz");
    expect(derivedText).not.toContain("/compact");
    expect(derivedText).not.toContain("/reasoning");

    // Proves that adding a command to dispatch without manifest fails the completeness check
    const incompleteManifest = COMMAND_MANIFEST.filter((c) => !c.name.includes("/compact"));
    const incompleteOutput = helpLines({ commands: incompleteManifest }).join("\n");
    const missing = commandArms.filter((cmd) => !incompleteOutput.includes(cmd));
    expect(missing).toContain("/compact");
  });

  it("(2) every settings entry appears in help output", () => {
    const help = helpLines().join("\n");
    for (const setting of SETTINGS) {
      expect(help, `missing setting key: ${setting.key}`).toContain(setting.key);
    }

    // Derived proof: passing custom settings derives only those settings
    const synthetic = [{ key: "synth_knob_abc", description: "custom knob for derivation check" }];
    const derivedText = helpLines({ settings: synthetic }).join("\n");
    expect(derivedText).toContain("synth_knob_abc");
    expect(derivedText).not.toContain("minwidth");
    expect(derivedText).not.toContain("grouping");
  });

  it("(3) output fits a 60 column terminal without a single line exceeding it", () => {
    const lines60 = helpLines({ width: 60 });
    expect(lines60.length).toBeGreaterThan(0);
    for (const line of lines60) {
      expect(line.length, `line exceeded 60 chars: "${line}"`).toBeLessThanOrEqual(60);
    }

    // Default export must also fit 60 column terminal
    for (const line of HELP_LINES) {
      expect(line.length, `default line exceeded 60 chars: "${line}"`).toBeLessThanOrEqual(60);
    }
  });

  it("(4) help still renders cleanly with no colours passed", () => {
    const plain = helpLines({ colors: {} });
    expect(plain.length).toBeGreaterThan(0);
    const text = plain.join("\n");
    // No ANSI escape codes emitted when colors object is empty
    expect(text).not.toMatch(/\x1b\[/);

    // Also renders when colors parameter is omitted entirely
    const defaultPlain = helpLines();
    expect(defaultPlain.join("\n")).not.toMatch(/\x1b\[/);
  });

  it("contains no em dash characters anywhere in generated help output", () => {
    expect(HELP_TEXT).not.toContain("\u2014");
    for (const line of HELP_LINES) {
      expect(line).not.toContain("\u2014");
    }
    for (const line of helpLines({ width: 60 })) {
      expect(line).not.toContain("\u2014");
    }
  });
});
