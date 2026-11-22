import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  defaultSettings,
  detectConflicts,
  formatSettingsTable,
  loadKeybinds,
  loadSettings,
  resolveKeybind,
  resolveSetting,
  saveSettings,
} from "./mso-agent-settings.mjs";
import { handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";

describe("MSO Agent Settings Registry", () => {
  it("1. a missing settings file returns defaults", () => {
    const missing = loadSettings({
      path: "/nonexistent/settings.json",
      readFile: () => {
        const err = new Error("ENOENT");
        // @ts-expect-error test code property
        err.code = "ENOENT";
        throw err;
      },
    });
    expect(missing).toEqual(defaultSettings());
    expect(missing.pane).toBe("off");
    expect(missing.statusbar).toBe("on");
  });

  it("2. a malformed file returns defaults and does not throw", () => {
    let result: any = null;
    expect(() => {
      result = loadSettings({
        path: "/corrupt/settings.json",
        readFile: () => "{ invalid: json",
      });
    }).not.toThrow();
    expect(result).toEqual(defaultSettings());
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("malformed JSON");
  });

  it("3. unknown keys written by a newer version survive a save", () => {
    let written = "";
    const seed = JSON.stringify({
      future_feature_flag: true,
      newer_schema_version: 42,
      pane: "off",
    });

    const saved: Record<string, any> = saveSettings(
      { pane: "todos" },
      {
        path: "/mock/settings.json",
        readFile: () => seed,
        writeFile: (_p, data) => { written = data; },
      },
    );

    expect(saved.pane).toBe("todos");
    expect(saved.future_feature_flag).toBe(true);
    expect(saved.newer_schema_version).toBe(42);

    const parsed = JSON.parse(written);
    expect(parsed.future_feature_flag).toBe(true);
    expect(parsed.newer_schema_version).toBe(42);
    expect(parsed.pane).toBe("todos");
  });

  it("4. resolveSetting resolves exact and unique-prefix, and refuses ambiguous with a distinct result", () => {
    const entries = [
      { category: "Session", key: "pane", path: "session.pane", description: "Pane", default: "off", values: ["off", "todos"] },
      { category: "Session", key: "statusbar", path: "session.status_bar", description: "Status", default: "on", values: ["on", "off"] },
      { category: "Session", key: "statusmode", path: "session.status_mode", description: "Mode", default: "full", values: ["full", "compact"] },
    ];

    // Exact key match
    const exact = resolveSetting(entries, "pane");
    expect(exact?.status).toBe("exact");
    expect(exact?.entry?.key).toBe("pane");

    // Unique prefix match
    const unique = resolveSetting(entries, "p");
    expect(unique?.status).toBe("prefix");
    expect(unique?.entry?.key).toBe("pane");

    // Ambiguous prefix match refused with distinct result
    const amb = resolveSetting(entries, "status");
    expect(amb?.status).toBe("ambiguous");
    expect(amb?.entry).toBeNull();
    expect(amb?.ambiguous?.map((e: any) => e.key)).toEqual(["statusbar", "statusmode"]);

    // Unknown setting returns null
    expect(resolveSetting(entries, "nonexistent")).toBeNull();
  });

  it("5. the table renders within width and has no ANSI when colours are empty", () => {
    const formatted = formatSettingsTable(SETTINGS, defaultSettings(), { width: 50 });
    expect(formatted).not.toContain("\x1b");
    const lines = formatted.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(50);
    }
    expect(formatted).toContain("Settings");
    expect(formatted).toContain("pane");
    expect(formatted).toContain("statusbar");
  });

  it("6. every declared entry has a non-empty description and a default that is within its own values when values is present", () => {
    expect(SETTINGS.length).toBeGreaterThan(0);
    for (const entry of SETTINGS) {
      expect(entry.category).toBeTruthy();
      expect(entry.key).toBeTruthy();
      expect(entry.path).toBeTruthy();
      expect(typeof entry.description).toBe("string");
      expect(entry.description.trim().length).toBeGreaterThan(0);
      if (entry.values) {
        expect(Array.isArray(entry.values)).toBe(true);
        expect(entry.values).toContain(entry.default);
      }
    }
  });

  it("existing keybind behaviour unchanged: loads hand-written file, resolves binds and detects conflicts", () => {
    const rawKeymap = JSON.stringify({
      interrupt: "ctrl+c",
      clear_screen: "ctrl+k",
      dismiss: "escape",
      submit: "ctrl+c",
    });

    const loaded = loadKeybinds({
      path: "/user/keybinds.json",
      readFile: () => rawKeymap,
    });

    // Custom binding resolves correctly
    expect(resolveKeybind({ ctrl: true, name: "k" }, loaded.bindings)).toBe("clear_screen");
    // Standard binding resolves correctly
    expect(resolveKeybind({ name: "escape" }, loaded.bindings)).toBe("dismiss");

    // detectConflicts still detects the conflict between interrupt and submit on ctrl+c
    const conflicts = detectConflicts(loaded.bindings);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].key).toBe("ctrl+c");
    expect(conflicts[0].actions).toContain("interrupt");
    expect(conflicts[0].actions).toContain("submit");
  });

  it("handleSettingsCommand updates session state and rejects invalid values", async () => {
    const printed: string[] = [];
    const session: any = { paneKind: "off", statusBar: true };
    const ctx = {
      session,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Valid update updates session
    await handleSettingsCommand(ctx, ["pane", "todos"]);
    expect(session.paneKind).toBe("todos");

    // Invalid value rejected
    await handleSettingsCommand(ctx, ["pane", "invalid_choice"]);
    expect(session.paneKind).toBe("todos");
    expect(printed.some((p) => p.includes("invalid value"))).toBe(true);

    // Reset restores defaults
    await handleSettingsCommand(ctx, ["reset"]);
    expect(session.paneKind).toBe("off");
  });
});
