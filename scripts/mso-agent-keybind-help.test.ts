import { afterEach, describe, expect, it, vi } from "vitest";
import { helpLines, printHelp } from "./mso-agent-help.mjs";
import {
  defaultKeybinds,
  formatKeybindTable,
  getKeybinds,
  loadKeybinds,
} from "./mso-agent-keybinds.mjs";

function resetToDefaults() {
  // Resets module cache in keybinds loader to clean defaults to avoid test cross-pollution.
  loadKeybinds({
    path: "/clean/keybinds.json",
    readFile: () => {
      const err = new Error("ENOENT");
      // @ts-expect-error test error code
      err.code = "ENOENT";
      throw err;
    },
  });
}

function extractKeyboardSection(lines: string[]): string {
  // Isolate keyboard section lines so assertions evaluate keybind formatting without false positives.
  const idx = lines.findIndex((line) => line.trim() === "Keyboard");
  return idx >= 0 ? lines.slice(idx).join("\n") : "";
}

describe("MSO Agent keybind help parity", () => {
  afterEach(() => {
    resetToDefaults();
  });

  it("(1) with no keybind file, help shows defaults and no markers", () => {
    resetToDefaults();

    const kbText = extractKeyboardSection(helpLines({ keybinds: getKeybinds() }));

    // Shipped defaults must be displayed when no user configuration exists.
    expect(kbText).toContain("Ctrl+C");
    expect(kbText).toContain("Ctrl+L");
    expect(kbText).toContain("Escape");
    expect(kbText).toContain("Tab (empty prompt)");
    expect(kbText).toContain("Ctrl+P");
    expect(kbText).toContain("Ctrl+N");
    expect(kbText).toContain("Return");

    // Asterisk customization marker must not be present when using shipped defaults.
    expect(kbText).not.toContain("*");
  });

  it("(2) with a custom file changing one action, that action shows the custom key and a marker", () => {
    // Simulate user editing ~/.mso/keybinds.json to rebind clear_screen to ctrl+k.
    loadKeybinds({
      path: "/user/keybinds.json",
      readFile: () => JSON.stringify({ clear_screen: "ctrl+k" }),
    });

    const kbText = extractKeyboardSection(helpLines({ keybinds: getKeybinds() }));

    // Changed action reflects the effective key and displays the customization marker.
    expect(kbText).toContain("Ctrl+K*");

    // Unchanged actions retain their default keys without customization markers.
    expect(kbText).toContain("Ctrl+C");
    expect(kbText).not.toContain("Ctrl+C*");
    expect(kbText).toContain("Escape");
    expect(kbText).not.toContain("Escape*");

    // Marker count verifies that exactly one customization is flagged.
    const markerMatches = kbText.match(/\*/g) || [];
    expect(markerMatches.length).toBe(1);

    // Verify printHelp() passes effective keybinds down to printer output.
    const captured: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      captured.push(String(msg));
    });
    try {
      printHelp();
      expect(captured.join("\n")).toContain("Ctrl+K*");
    } finally {
      spy.mockRestore();
    }
  });

  it("(3) a malformed file does not throw and shows no markers", () => {
    // Malformed JSON must be gracefully handled by falling back to shipped defaults.
    expect(() => {
      loadKeybinds({
        path: "/corrupt/keybinds.json",
        readFile: () => "{ broken json",
      });
    }).not.toThrow();

    let output = "";
    expect(() => {
      output = helpLines({ keybinds: getKeybinds() }).join("\n");
    }).not.toThrow();

    const kbText = extractKeyboardSection(output.split("\n"));

    // Help must display defaults without flagging them as custom.
    expect(kbText).toContain("Ctrl+C");
    expect(kbText).toContain("Ctrl+L");
    expect(kbText).not.toContain("*");
  });

  it("(4) the help keyboard section and formatKeybindTable agree on the effective key for every action, asserted action by action", () => {
    // Test agreement across both default bindings and multiple custom user bindings.
    const configs = [
      {
        name: "defaults",
        bindings: defaultKeybinds(),
      },
      {
        name: "customized",
        bindings: {
          interrupt: "ctrl+x",
          clear_screen: "ctrl+k",
          dismiss: "alt+q",
          complete: "ctrl+space",
          history_prev: "alt+p",
          history_next: "alt+n",
          submit: "return",
        },
      },
    ];

    for (const { bindings } of configs) {
      const table = formatKeybindTable(bindings);
      const kbText = extractKeyboardSection(helpLines({ keybinds: bindings }));

      for (const [action, rawKey] of Object.entries(bindings)) {
        // Table output contains normalized action identifier and key token.
        expect(table).toContain(action);
        expect(table).toContain(rawKey);

        // Convert normalized key token to human-readable form used in help lines.
        const pretty = rawKey
          .split("+")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join("+");

        // The help keyboard section agrees on the effective key for every action.
        expect(
          kbText,
          `help keyboard section should contain key "${pretty}" for action "${action}"`
        ).toContain(pretty);
      }
    }
  });
});
