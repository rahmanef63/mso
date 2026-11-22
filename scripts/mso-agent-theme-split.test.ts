import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  applyTheme as applyThemeUi,
  C as CFromUi,
  currentThemeName as currentThemeUi,
} from "./mso-agent-ui.mjs";
import {
  applyTheme as applyThemeDirect,
  C as CFromTheme,
  currentThemeName as currentThemeDirect,
} from "./mso-agent-theme.mjs";

describe("theme split reference and mutation parity", () => {
  it("exports the exact same C object reference from both modules", () => {
    expect(CFromUi).toBe(CFromTheme);
  });

  it("reflects applyTheme mutations identically through both references", () => {
    const origTTY = process.stdout.isTTY;
    const origNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.stdout.isTTY = true;
    try {
      applyThemeDirect("dark");
      expect(currentThemeDirect()).toBe("dark");
      expect(currentThemeUi()).toBe("dark");
      expect(CFromUi.blue).toBe(CFromTheme.blue);
      expect(CFromUi.blue).toContain("38;2;58;160;255");

      applyThemeUi("light");
      expect(currentThemeDirect()).toBe("light");
      expect(currentThemeUi()).toBe("light");
      expect(CFromUi.blue).toBe(CFromTheme.blue);
      expect(CFromUi.blue).toContain("38;2;21;94;183");

      applyThemeDirect("mono");
      expect(currentThemeDirect()).toBe("mono");
      expect(currentThemeUi()).toBe("mono");
      expect(CFromUi.blue).toBe("");
      expect(CFromTheme.blue).toBe("");
    } finally {
      process.stdout.isTTY = origTTY;
      if (origNoColor !== undefined) process.env.NO_COLOR = origNoColor;
      else delete process.env.NO_COLOR;
      applyThemeDirect("dark");
    }
  });
});
