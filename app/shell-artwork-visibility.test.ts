import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The shell renders three artwork variants per app and lets CSS pick one. That only works
// if the rule that reveals a variant also UNDOES the rule that hides the others: `display`
// and `content-visibility` are independent properties, so setting `display: block` alone
// leaves the winner with `content-visibility: hidden` and the icon paints nothing.
//
// That exact bug shipped: the reveal rules said only `display: block`, so macOS, iOS,
// Windows and Android app icons were blank. No test caught it because no test reads CSS
// cascade intent. This one does, at the level the bug actually lived.

const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const flat = css.replace(/\s+/g, " ");

/** Body of every rule whose selector list contains `selector`. */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

describe("shell artwork variant visibility", () => {
  it("hides the non-matching variants in layout and paint", () => {
    // The hide rule lists both selectors together:
    //   .shell-artwork-macos, .shell-artwork-windows { display: none; content-visibility: hidden }
    const bodies = flat
      .match(/([^{}]*shell-artwork-macos[^{}]*)\{([^{}]*)\}/g) ?? [];
    const hides = bodies.filter((rule) => /display:\s*none/.test(rule));
    expect(hides.length, "a rule must hide the non-matching variants").toBeGreaterThan(0);
    expect(
      hides.some((rule) => /content-visibility:\s*hidden/.test(rule)),
      "the hide rule must also drop the variant out of paint",
    ).toBe(true);
  });

  it.each([
    '[data-shell="macos"] .shell-artwork-macos',
    '[data-shell="ios"] .shell-artwork-macos',
    '[data-shell="windows"] .shell-artwork-windows',
    '[data-shell="android"] .shell-artwork-windows',
  ])("%s reveals its variant completely", (selector) => {
    const bodies = ruleBodies(selector).filter((b) => b.includes("display: block"));
    expect(bodies.length, `${selector} must set display: block`).toBeGreaterThan(0);
    // The regression: display alone leaves the winner invisible.
    expect(
      bodies.some((b) => b.includes("content-visibility: visible")),
      `${selector} must also restore content-visibility, or the icon renders blank`,
    ).toBe(true);
  });
});
