import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  defaultSettings,
  formatSettingsTable,
  loadSettings,
} from "./mso-agent-settings.mjs";
import { applySettings, handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";

describe("tabs.layout preference registry integration", () => {
  it("1. the entry appears in the table and in defaultSettings()", () => {
    const defaults: Record<string, any> = defaultSettings();
    // Default layout must default to horizontal row so existing behavior is preserved
    expect(defaults.layout).toBe("horizontal");

    const entry = SETTINGS.find((e) => e.key === "layout");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("Tabs");
    expect(entry?.path).toBe("tabs.layout");
    expect(entry?.values).toEqual(["horizontal", "vertical"]);
    expect(entry?.keywords).toContain("sidebar");
    expect(entry?.keywords).toContain("rail");

    const table = formatSettingsTable(SETTINGS, defaults, { width: 80 });
    expect(table).toContain("layout");
    expect(table).toContain("horizontal");
    expect(table).toContain("Tab bar layout orientation");
  });

  it("2. /settings layout vertical sets session.tabsLayout in live session", async () => {
    const printed: string[] = [];
    const session: Record<string, any> = { tabsLayout: "horizontal" };
    const ctx = {
      session,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Setting layout should immediately update session without waiting for restart
    await handleSettingsCommand(ctx, ["layout", "vertical"]);
    expect(session.tabsLayout).toBe("vertical");
    expect(printed.some((line) => line.includes("setting layout = vertical"))).toBe(true);

    // Using the full dotted path tabs.layout should also resolve and set session
    await handleSettingsCommand(ctx, ["tabs.layout", "horizontal"]);
    expect(session.tabsLayout).toBe("horizontal");
    expect(printed.some((line) => line.includes("setting layout = horizontal"))).toBe(true);
  });

  it("3. applySettings sets tabsLayout from a saved file", () => {
    // When saved with dotted path key in settings JSON file
    const loadedFromPath = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ "tabs.layout": "vertical" }),
    });
    const sessionA: Record<string, any> = {};
    applySettings(sessionA, loadedFromPath);
    expect(sessionA.tabsLayout).toBe("vertical");

    // When saved with simple key in settings JSON file
    const loadedFromKey = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ layout: "vertical" }),
    });
    const sessionB: Record<string, any> = {};
    applySettings(sessionB, loadedFromKey);
    expect(sessionB.tabsLayout).toBe("vertical");

    // Direct object passed to applySettings
    const sessionC: Record<string, any> = {};
    applySettings(sessionC, { "tabs.layout": "vertical" });
    expect(sessionC.tabsLayout).toBe("vertical");
  });

  it("4. an invalid value is refused with the valid list, not silently coerced", async () => {
    const printed: string[] = [];
    const session: Record<string, any> = { tabsLayout: "horizontal" };
    const ctx = {
      session,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Refuse invalid layout option without altering running session
    await handleSettingsCommand(ctx, ["layout", "diagonal"]);
    expect(session.tabsLayout).toBe("horizontal");
    const warning = printed.find((line) => line.includes("invalid value"));
    expect(warning).toBeDefined();
    expect(warning).toContain("horizontal, vertical");
  });

  it("5. the other two entries still work alongside layout", async () => {
    const printed: string[] = [];
    const session: Record<string, any> = {
      paneKind: "off",
      statusBar: true,
      tabsLayout: "horizontal",
    };
    const ctx = {
      session,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Update pane
    await handleSettingsCommand(ctx, ["pane", "diff"]);
    expect(session.paneKind).toBe("diff");

    // Update statusbar
    await handleSettingsCommand(ctx, ["statusbar", "off"]);
    expect(session.statusBar).toBe(false);

    // Apply settings containing all three
    const targetSession: Record<string, any> = {};
    applySettings(targetSession, {
      pane: "todos",
      statusbar: "on",
      layout: "vertical",
    });
    expect(targetSession.paneKind).toBe("todos");
    expect(targetSession.statusBar).toBe(true);
    expect(targetSession.tabsLayout).toBe("vertical");
  });
});
