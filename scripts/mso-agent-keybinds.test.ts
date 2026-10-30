import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  defaultKeybinds,
  detectConflicts,
  formatKeybindTable,
  loadKeybinds,
  normalizeKey,
  resolveKeybind,
} from "./mso-agent-keybinds.mjs";

describe("MSO Agent Keybinds", () => {
  it("defaults reproduce today's behaviour: resolving ctrl+c, ctrl+l, escape and tab yields the same actions", () => {
    const defaults = defaultKeybinds();
    expect(resolveKeybind({ ctrl: true, name: "c" }, defaults)).toBe("interrupt");
    expect(resolveKeybind({ ctrl: true, name: "l" }, defaults)).toBe("clear_screen");
    expect(resolveKeybind({ name: "escape" }, defaults)).toBe("dismiss");
    expect(resolveKeybind({ name: "tab" }, defaults)).toBe("complete");
    expect(resolveKeybind({ ctrl: true, name: "p" }, defaults)).toBe("history_prev");
    expect(resolveKeybind({ ctrl: true, name: "n" }, defaults)).toBe("history_next");
    expect(resolveKeybind({ name: "return" }, defaults)).toBe("submit");
    expect(resolveKeybind({ name: "enter" }, defaults)).toBe("submit");
  });

  it("an empty or missing config file yields defaults and no warnings", () => {
    const missing = loadKeybinds({
      path: "/nonexistent/keybinds.json",
      readFile: () => {
        const err = new Error("ENOENT");
        // @ts-expect-error test code property
        err.code = "ENOENT";
        throw err;
      },
    });
    expect(missing.bindings).toEqual(defaultKeybinds());
    expect(missing.warnings).toEqual([]);

    const empty = loadKeybinds({
      path: "/empty/keybinds.json",
      readFile: () => "",
    });
    expect(empty.bindings).toEqual(defaultKeybinds());
    expect(empty.warnings).toEqual([]);

    const emptyObj = loadKeybinds({
      path: "/empty-obj/keybinds.json",
      readFile: () => "{}",
    });
    expect(emptyObj.bindings).toEqual(defaultKeybinds());
    expect(emptyObj.warnings).toEqual([]);
  });

  it("a malformed JSON file yields defaults and a warning, and does not throw", () => {
    const malformed = loadKeybinds({
      path: "/bad/keybinds.json",
      readFile: () => "{ not valid json",
    });
    expect(malformed.bindings).toEqual(defaultKeybinds());
    expect(malformed.warnings.length).toBeGreaterThan(0);
    expect(malformed.warnings[0]).toContain("malformed JSON");
  });

  it("an unknown action name is dropped with a warning that names it", () => {
    const result = loadKeybinds({
      path: "/custom/keybinds.json",
      readFile: () => JSON.stringify({
        unknown_foo: "ctrl+t",
        clear_screen: "ctrl+k",
      }),
    });
    expect(result.bindings.clear_screen).toBe("ctrl+k");
    expect(result.bindings.unknown_foo).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("unknown_foo"))).toBe(true);
  });

  it("two actions bound to the same key produce a conflict, and detectConflicts reports it", () => {
    const conflicting = {
      ...defaultKeybinds(),
      clear_screen: "ctrl+c",
    };
    const conflicts = detectConflicts(conflicting);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].key).toBe("ctrl+c");
    expect(conflicts[0].actions).toContain("interrupt");
    expect(conflicts[0].actions).toContain("clear_screen");
  });

  it("a user binding overrides a default for that key only, leaving other defaults intact", () => {
    const defaults = defaultKeybinds();
    const result = loadKeybinds({
      path: "/user/keybinds.json",
      readFile: () => JSON.stringify({
        clear_screen: "ctrl+k",
      }),
    });
    expect(result.bindings.clear_screen).toBe("ctrl+k");
    expect(result.bindings.interrupt).toBe(defaults.interrupt);
    expect(result.bindings.dismiss).toBe(defaults.dismiss);
    expect(result.bindings.complete).toBe(defaults.complete);
    expect(result.bindings.history_prev).toBe(defaults.history_prev);
    expect(result.bindings.history_next).toBe(defaults.history_next);
    expect(result.bindings.submit).toBe(defaults.submit);
  });

  it("formatKeybindTable shows every resolved binding and no ANSI codes when no palette is passed", () => {
    const defaults = defaultKeybinds();
    const formatted = formatKeybindTable(defaults);
    expect(formatted).not.toContain("\x1b");
    for (const [action, key] of Object.entries(defaults)) {
      expect(formatted).toContain(action);
      expect(formatted).toContain(key);
      expect(formatted).toContain(ACTIONS[action as keyof typeof ACTIONS]);
    }
  });

  it("normalizes keys and warns when overriding readline editing keys", () => {
    expect(normalizeKey("Ctrl + C")).toBe("ctrl+c");
    expect(normalizeKey("ALT+B")).toBe("alt+b");
    expect(normalizeKey({ ctrl: true, name: "c" })).toBe("ctrl+c");

    const result = loadKeybinds({
      path: "/override/keybinds.json",
      readFile: () => JSON.stringify({
        toggle_status_bar: "ctrl+a",
      }),
    });
    expect((result.bindings as Record<string, string>).toggle_status_bar).toBe("ctrl+a");
    expect(result.warnings.some((w) => w.includes("overrides line editing"))).toBe(true);
  });
});
