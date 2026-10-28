import { describe, expect, it } from "vitest";
import {
  C,
  applyTheme,
  currentThemeName,
  themeNames,
} from "./mso-agent-ui.mjs";

describe("MSO Agent UI theme engine", () => {
  it("applyTheme('light') in a non-TTY returns theme 'mono' and a reason mentioning colour disabled", () => {
    delete process.env.NO_COLOR;
    const res = applyTheme("light");
    expect(res.theme).toBe("mono");
    expect(res.changed).toBe(false);
    expect(res.reason).toMatch(/colour disabled/i);
  });

  it("applyTheme('bogus') keeps the current name and returns a reason naming the unknown theme", () => {
    const origIsTTY = process.stdout.isTTY;
    try {
      process.stdout.isTTY = true;
      const current = currentThemeName();
      const res = applyTheme("bogus");
      expect(res.theme).toBe(current);
      expect(res.changed).toBe(false);
      expect(res.reason).toMatch(/unknown theme "bogus"/i);
    } finally {
      process.stdout.isTTY = origIsTTY;
    }
  });

  it("themeNames() includes dark, light, mono", () => {
    const names = themeNames();
    expect(names).toContain("dark");
    expect(names).toContain("light");
    expect(names).toContain("mono");
  });

  it("C.a === C.blue and C.c === C.cyan after an applyTheme call (alias follows)", () => {
    const origIsTTY = process.stdout.isTTY;
    try {
      process.stdout.isTTY = true;
      applyTheme("dark");
      expect((C as any).a).toBe(C.blue);
      expect((C as any).c).toBe(C.cyan);
    } finally {
      process.stdout.isTTY = origIsTTY;
    }
  });
});
