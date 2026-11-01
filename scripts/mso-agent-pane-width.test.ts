import { describe, expect, it } from "vitest";
import { paneWidth } from "./mso-agent-pane.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import {
  SETTINGS,
  defaultSettings,
  formatSettingsTable,
  loadSettings,
} from "./mso-agent-settings.mjs";
import {
  applySettings,
  handleSettingsCommand,
} from "./mso-agent-cmd-settings.mjs";

describe("TUI pane width configuration end to end", () => {
  it("1. default is 100 and paneWidth(120) unchanged", () => {
    // Verifies default configuration preserves existing baseline behaviour
    const defaults: Record<string, any> = defaultSettings();
    expect(defaults.minwidth).toBe(100);

    // Byte-identical check: 120 * 0.35 = 42 without options
    const widthUnconfigured = paneWidth(120);
    expect(widthUnconfigured).toBe(42);

    const widthExplicitDefault = paneWidth(120, { minColumns: 100 });
    expect(widthExplicitDefault).toBe(42);
  });

  it("2. paneWidth(90) is 0 with the default and non-zero with minColumns: 80", () => {
    // 90 columns is below default threshold 100, yielding 0 width
    expect(paneWidth(90)).toBe(0);
    expect(paneWidth(90, { minColumns: 100 })).toBe(0);

    // Lowering threshold to 80 allows narrower terminal to allocate 31 columns
    const widthLowered = paneWidth(90, { minColumns: 80 });
    expect(widthLowered).toBe(31);
    expect(widthLowered).toBeGreaterThan(0);

    // Integration check: mountScreenLoop reflects session.paneMinColumns
    const fakeStdout = {
      isTTY: true,
      columns: 90,
      rows: 24,
      write() {},
    };
    const defaultSession = { paneKind: "todos" };
    const loopDefault = mountScreenLoop({
      session: defaultSession,
      enabled: true,
      output: fakeStdout,
      input: { on() {}, off() {} },
    });
    expect(loopDefault.geometry().pWidth).toBe(0);
    loopDefault.dispose();

    const customSession = { paneKind: "todos", paneMinColumns: 80 };
    const loopCustom = mountScreenLoop({
      session: customSession,
      enabled: true,
      output: fakeStdout,
      input: { on() {}, off() {} },
    });
    expect(loopCustom.geometry().pWidth).toBe(31);
    loopCustom.dispose();
  });

  it("3. the setting rejects 59 and 201 with a range message", async () => {
    // Verify CLI rejects bounds below 60 and above 200 with an informative range message
    const printed: string[] = [];
    const ctx = {
      session: {},
      C: {},
      write: (line: string) => printed.push(line),
    };

    await handleSettingsCommand(ctx, ["minwidth", "59"]);
    const reject59 = printed[printed.length - 1];
    expect(reject59).toContain("invalid value \"59\" for minwidth");
    expect(reject59).toContain("accepted range is 60 to 200");

    await handleSettingsCommand(ctx, ["minwidth", "201"]);
    const reject201 = printed[printed.length - 1];
    expect(reject201).toContain("invalid value \"201\" for minwidth");
    expect(reject201).toContain("accepted range is 60 to 200");

    // Also verify settings file loader rejects out-of-range bounds
    const loaded59 = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ minwidth: 59 }),
    });
    expect(loaded59.minwidth).toBe(100);
    expect(loaded59.warnings.some((w: string) => w.includes("invalid value \"59\""))).toBe(true);

    const loaded201 = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ minwidth: 201 }),
    });
    expect(loaded201.minwidth).toBe(100);
    expect(loaded201.warnings.some((w: string) => w.includes("invalid value \"201\""))).toBe(true);
  });

  it("4. applySettings sets the session field from a saved file", () => {
    // Config loader handles both setting key and dotted path notation
    const loadedFromPath = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ "session.pane_min_columns": 85 }),
    });
    expect(loadedFromPath.minwidth).toBe(85);

    const session: any = {};
    applySettings(session, loadedFromPath);
    expect(session.paneMinColumns).toBe(85);

    const loadedFromKey = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ minwidth: 75 }),
    });
    expect(loadedFromKey.minwidth).toBe(75);

    applySettings(session, loadedFromKey);
    expect(session.paneMinColumns).toBe(75);
  });

  it("5. a numeric entry renders in the settings table within width", () => {
    // Table layout fits within restricted column width without line overflow
    const formattedNarrow = formatSettingsTable(SETTINGS, defaultSettings(), { width: 50 });
    const narrowLines = formattedNarrow.split("\n");
    for (const line of narrowLines) {
      expect(line.length).toBeLessThanOrEqual(50);
    }

    const formattedNormal = formatSettingsTable(
      SETTINGS,
      { minwidth: 80 },
      { width: 80 },
    );
    expect(formattedNormal).toContain("minwidth");
    expect(formattedNormal).toContain("80");
    const normalLines = formattedNormal.split("\n");
    for (const line of normalLines) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });
});
