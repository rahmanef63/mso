import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composerFooter } from "./mso-agent-layout.mjs";
import { resolveVerbosity, statusParts } from "./mso-agent-status.mjs";
import { SETTINGS, loadSettings } from "./mso-agent-settings.mjs";
import { handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";

const colors = { blue: "", bold: "", reset: "", dim: "", c: "", cyan: "", warn: "", err: "" };

function makeSession(verbosity?: string, cwd?: string): any {
  return {
    permission: "ask",
    statusBar: true,
    verbosity,
    history: [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
      { role: "user", text: "do something" },
    ],
    usage: { inputTokens: 1200, outputTokens: 350, totalTokens: 1550 },
    state: {
      config: { provider: "openai-codex", model: "gpt-5.6-terra" },
      modelMeta: { context: 128000 },
    },
    agentSession: {
      id: "session-test-id",
      name: "agent",
      title: "Review auth",
      compactThresholdTokens: 700000,
      estimatedTokens: 120,
    },
    cwd: cwd || path.join(os.homedir(), "projects", "mso"),
  };
}

describe("MSO Agent status verbosity setting", () => {
  // Test 1: High verbosity (default) must reproduce existing footer output exactly
  it("default high produces byte-identical footer to recorded fixtures at 60, 100, 160 columns", () => {
    const fixture60 = "mode ask · openai-codex/gpt-5.6-terra · ctx ~27/128k 0% ·…";
    const fixture100 = "mode ask · openai-codex/gpt-5.6-terra · ctx ~27/128k 0% · session ~120/700k · tokens 1.6k · turns…";
    const fixture160 = "mode ask · openai-codex/gpt-5.6-terra · ctx ~27/128k 0% · session ~120/700k · tokens 1.6k · turns 2 · session Review auth · ~/projects/mso · Tab cycle";

    // Unset verbosity uses default high
    const sessionDefault = makeSession(undefined);
    expect(composerFooter(sessionDefault, colors, 60)).toBe(fixture60);
    expect(composerFooter(sessionDefault, colors, 100)).toBe(fixture100);
    expect(composerFooter(sessionDefault, colors, 160)).toBe(fixture160);

    // Explicit high matches recorded fixtures byte-for-byte
    const sessionHigh = makeSession("high");
    expect(composerFooter(sessionHigh, colors, 60)).toBe(fixture60);
    expect(composerFooter(sessionHigh, colors, 100)).toBe(fixture100);
    expect(composerFooter(sessionHigh, colors, 160)).toBe(fixture160);
  });

  // Test 2: Low verbosity drops static metadata (model, cwd) while preserving live state
  it("low drops provider/model and cwd and still shows mode, context and turns", () => {
    const sessionLow = makeSession("low");
    const parts = statusParts(sessionLow);
    const joined = parts.join(" · ");

    // Model and cwd must be omitted to save space on narrow terminals
    expect(joined).not.toContain("openai-codex/gpt-5.6-terra");
    expect(joined).not.toContain("~/projects/mso");

    // Live conversation telemetry must be preserved
    expect(joined).toContain("ctx ~27/128k 0%");
    expect(joined).toContain("turns 2");

    // Composer footer must show permission mode, context, turns, and omit model and cwd
    const footer = composerFooter(sessionLow, colors, 100);
    expect(footer).toContain("mode ask");
    expect(footer).toContain("ctx ~27/128k 0%");
    expect(footer).toContain("turns 2");
    expect(footer).not.toContain("openai-codex/gpt-5.6-terra");
    expect(footer).not.toContain("~/projects/mso");
  });

  // Test 3: Medium verbosity drops only cwd
  it("medium drops only cwd", () => {
    const sessionMedium = makeSession("medium");
    const parts = statusParts(sessionMedium);
    const joined = parts.join(" · ");

    // Model remains visible in medium
    expect(joined).toContain("openai-codex/gpt-5.6-terra");
    // Only cwd is dropped
    expect(joined).not.toContain("~/projects/mso");

    // Other status chips remain intact
    expect(joined).toContain("ctx ~27/128k 0%");
    expect(joined).toContain("turns 2");
    expect(joined).toContain("session Review auth");

    const footer = composerFooter(sessionMedium, colors, 160);
    expect(footer).toContain("mode ask");
    expect(footer).toContain("openai-codex/gpt-5.6-terra");
    expect(footer).not.toContain("~/projects/mso");
  });

  // Test 4: Unknown setting values are rejected and safely fall back
  it("an unknown value is refused", async () => {
    // Registry definition specifies valid values
    const entry = SETTINGS.find((s) => s.key === "verbosity");
    expect(entry).toBeDefined();
    expect(entry?.values).toEqual(["low", "medium", "high"]);
    expect(entry?.default).toBe("high");

    // CLI settings command refuses invalid value
    const printed: string[] = [];
    const fakeCtx: any = {
      session: makeSession("high"),
      C: {},
      width: 80,
      write: (msg: string) => printed.push(msg),
    };
    await handleSettingsCommand(fakeCtx, ["verbosity", "ultra"]);
    expect(printed.some((msg) => msg.includes('invalid value "ultra" for verbosity'))).toBe(true);
    expect(fakeCtx.session.verbosity).toBe("high");

    // Loading settings from disk with invalid value falls back to default with a warning
    const loaded = loadSettings({
      path: "/fake/settings.json",
      readFile: () => JSON.stringify({ verbosity: "invalid-level" }),
    });
    expect(loaded.verbosity).toBe("high");
    expect(loaded.warnings.some((w: string) => w.includes('invalid value "invalid-level" for verbosity'))).toBe(true);

    // Pure helper falls back to high
    expect(resolveVerbosity({ verbosity: "unknown" })).toBe("high");
    expect(resolveVerbosity(null, { verbosity: "unknown" })).toBe("high");
  });

  // Test 5: Footer never exceeds the requested terminal width in any verbosity mode
  it("the footer never exceeds the requested width in any mode", () => {
    const modes = ["low", "medium", "high"];
    const widths = [30, 45, 60, 80, 100, 120, 160];

    for (const mode of modes) {
      const session = makeSession(mode);
      for (const w of widths) {
        const line = composerFooter(session, colors, w);
        // Visible character width must never exceed the target column limit
        expect(Array.from(line).length).toBeLessThanOrEqual(w);
      }
    }
  });
});
