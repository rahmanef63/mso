import { describe, expect, it } from "vitest";
import { applySettings, handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";
import { handleMouse } from "./mso-agent-mouse.mjs";
import { defaultSettings, loadSettings } from "./mso-agent-settings.mjs";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";

describe("MSO Agent TUI scroll speed setting", () => {
  // Test 1: default 3 keeps today's behaviour, asserted against the current value.
  // We assert that the registered setting default is 3, defaultSettings returns 3,
  // and handleMouse without an explicit step still scrolls by exactly 3 lines.
  it("default 3 keeps today's behaviour, asserted against the current value", () => {
    const entry = SETTINGS.find((s) => s.key === "speed");
    expect(entry).toBeDefined();
    expect(entry?.default).toBe(3);
    expect(entry?.min).toBe(1);
    expect(entry?.max).toBe(10);
    expect(entry?.path).toBe("scroll.speed");

    const defaults: Record<string, any> = defaultSettings();
    expect(defaults.speed).toBe(3);

    // Assert handleMouse defaults to 3 lines per wheel event when no step option is supplied
    const scroll = { offset: 0 };
    const upConsumed = handleMouse(scroll, { kind: "wheel", button: "up" });
    expect(upConsumed).toBe(true);
    expect(scroll.offset).toBe(3);

    const downConsumed = handleMouse(scroll, { kind: "wheel", button: "down" });
    expect(downConsumed).toBe(true);
    expect(scroll.offset).toBe(0);
  });

  // Test 2: speed 1 moves one line and speed 10 moves ten.
  // Tests min and max bound velocities across both up and down directions.
  it("speed 1 moves one line and speed 10 moves ten", () => {
    const scroll = { offset: 0 };

    // Speed 1 moves by 1 line
    handleMouse(scroll, { kind: "wheel", button: "up" }, { step: 1 });
    expect(scroll.offset).toBe(1);
    handleMouse(scroll, { kind: "wheel", button: "down" }, { step: 1 });
    expect(scroll.offset).toBe(0);

    // Speed 10 moves by 10 lines
    handleMouse(scroll, { kind: "wheel", button: "up" }, { step: 10 });
    expect(scroll.offset).toBe(10);
    handleMouse(scroll, { kind: "wheel", button: "down" }, { step: 10 });
    expect(scroll.offset).toBe(0);

    // Also assert speed plumbed through session works identically
    const sessionFast = { scrollSpeed: 10 };
    handleMouse(scroll, { kind: "wheel", button: "up" }, { session: sessionFast });
    expect(scroll.offset).toBe(10);
    handleMouse(scroll, { kind: "wheel", button: "down" }, { session: sessionFast });
    expect(scroll.offset).toBe(0);
  });

  // Test 3: the setting is rejected below 1 and above 10 with a range message.
  // Rejects out-of-range values in CLI command and loader fallback.
  it("the setting is rejected below 1 and above 10 with a range message", async () => {
    const printed: string[] = [];
    const session: any = { scrollSpeed: 3 };
    const ctx = {
      session,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Below min (0) rejected with range message
    await handleSettingsCommand(ctx, ["speed", "0"]);
    expect(printed.some((msg) => msg.includes("accepted range is 1 to 10"))).toBe(true);
    expect(session.scrollSpeed).toBe(3);

    // Above max (11) rejected with range message
    printed.length = 0;
    await handleSettingsCommand(ctx, ["speed", "11"]);
    expect(printed.some((msg) => msg.includes("accepted range is 1 to 10"))).toBe(true);
    expect(session.scrollSpeed).toBe(3);

    // Negative numbers rejected
    printed.length = 0;
    await handleSettingsCommand(ctx, ["speed", "-5"]);
    expect(printed.some((msg) => msg.includes("accepted range is 1 to 10"))).toBe(true);
    expect(session.scrollSpeed).toBe(3);

    // loadSettings falls back to default 3 and records a warning for invalid values
    const loaded = loadSettings({
      path: "/mock/settings.json",
      readFile: () => JSON.stringify({ "scroll.speed": 0 }),
    });
    expect(loaded.speed).toBe(3);
    expect(loaded.warnings.some((w: string) => w.includes('invalid value "0" for speed'))).toBe(true);
  });

  // Test 4: a wheel event at any speed still never scrolls past the buffer bounds, asserted at both ends.
  // Viewport bounds clamp between offset 0 (bottom) and maxOffset (top).
  it("a wheel event at any speed still never scrolls past the buffer bounds, asserted at both ends", () => {
    // 30 lines with 10 visible rows yields maxOffset of 20
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const scroll = { lines, offset: 0, rows: 10 };

    // Lower bound: scrolling down from 0 cannot go below 0 at any speed
    for (const speed of [1, 3, 5, 10]) {
      scroll.offset = 0;
      const consumed = handleMouse(scroll, { kind: "wheel", button: "down" }, { step: speed });
      expect(consumed).toBe(true);
      expect(scroll.offset).toBe(0);
    }

    // Upper bound: scrolling up near maxOffset cannot exceed maxOffset (20)
    for (const speed of [1, 3, 5, 10]) {
      // Starting at maxOffset (20), scrolling up remains clamped at 20
      scroll.offset = 20;
      const consumedAtMax = handleMouse(scroll, { kind: "wheel", button: "up" }, { step: speed });
      expect(consumedAtMax).toBe(true);
      expect(scroll.offset).toBe(20);

      // Starting at 18, scrolling up with step larger than remaining distance clamps at 20
      scroll.offset = 18;
      handleMouse(scroll, { kind: "wheel", button: "up" }, { step: 10 });
      expect(scroll.offset).toBe(20);
    }

    // Downward clamping from mid-position to 0 with large step
    scroll.offset = 4;
    handleMouse(scroll, { kind: "wheel", button: "down" }, { step: 10 });
    expect(scroll.offset).toBe(0);
  });

  // Test 5: the value reaches handleMouse from a saved settings file through applySettings.
  // Confirms the full path: file -> loadSettings -> applySettings -> session -> handleMouse.
  it("the value reaches handleMouse from a saved settings file through applySettings", () => {
    const rawConfig = JSON.stringify({ "scroll.speed": 7 });
    const settings = loadSettings({
      path: "/user/settings.json",
      readFile: () => rawConfig,
    });
    expect(settings.speed).toBe(7);

    const session: any = {};
    applySettings(session, settings);
    expect(session.scrollSpeed).toBe(7);

    // Now test that handleMouse uses the session's scrollSpeed value
    const scroll = { offset: 0 };
    handleMouse(scroll, { kind: "wheel", button: "up" }, { step: session.scrollSpeed });
    expect(scroll.offset).toBe(7);

    // Also test direct session option plumbing
    scroll.offset = 0;
    handleMouse(scroll, { kind: "wheel", button: "up" }, { session });
    expect(scroll.offset).toBe(7);
  });
});
