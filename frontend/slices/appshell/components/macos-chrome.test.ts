import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOPBAR } from "../lib/store-geometry";

const css = readFileSync("frontend/slices/appshell/components/shells/macos/macos-shell.css", "utf8");
type Color = [number, number, number, number];
function color(raw: string): Color {
  if (raw.startsWith("#")) {
    const hex = raw.slice(1);
    const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).concat(1) as Color;
  }
  const parts = raw.match(/[\d.]+/g)!.map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
function over(front: Color, back: Color): Color {
  return [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])).concat(1) as Color;
}
function luminance(c: Color) {
  const values = c.slice(0, 3).map(n => {
    const s = n / 255;
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  });
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(a: Color, b: Color) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}
function declaration(block: string, name: string) {
  const value = new RegExp("(?:^|[;\\n])\\s*" + name + ":\\s*([^;]+)").exec(block)?.[1];
  if (!value) throw new Error("Missing CSS declaration: " + name);
  return color(value.trim());
}

describe("macOS chrome reference and contrast contract", () => {
  const bar = css.match(/\.macos-menubar\s*\{([^}]*)\}/)![1];
  const interaction = css.match(/\.macos-menu-trigger\[data-state="open"\]\s*\{([^}]*)\}/)![1];
  const text = declaration(bar, "color");
  const white: Color = [255, 255, 255, 1];

  it("normal, hover and open menu labels and status clock remain AA over white wallpaper", () => {
    expect(css).toContain(".macos-menubar .macos-status button:hover,\n.macos-menu-trigger[data-state=\"open\"]");
    const background = over(declaration(bar, "background"), white);
    const hover = over(declaration(interaction, "background"), background);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, hover)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["light", "dark"])("%s menu text remains AA over every wallpaper endpoint", mode => {
    const selector = mode === "light" ? /\.macos-menu\s*\{([^}]*)\}/ : /\[data-theme="dark"\] \.macos-menu\s*\{([^}]*)\}/;
    const block = css.match(selector)![1];
    for (const shade of [0, 255]) {
      const surface = over(declaration(block, "background"), [shade, shade, shade, 1]);
      expect(contrast(declaration(block, "color"), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("selected menu rows retain AA contrast", () => {
    const block = css.slice(css.indexOf('.macos-menu [role^="menuitem"]:is')).match(/\{([^}]*)\}/)![1];
    expect(contrast(declaration(block, "color"), declaration(block, "background"))).toBeGreaterThanOrEqual(4.5);
  });
  it("macOS work area uses the same 34px reference bar", () => expect(TOPBAR).toBe(34));
  it("reference styles stay scoped and never replace Spotlight tokens", () => {
    expect(css).not.toMatch(/:root|--glass-panel:|--glass-menu:|--text:|--surface:/);
    expect(css).toContain('[data-shell="macos"][data-shell]');
    expect(css).toContain("--shell-radius-win: 16px");
  });
});
