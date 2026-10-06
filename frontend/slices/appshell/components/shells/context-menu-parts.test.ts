/* ContextMenu parts (vitest, node env). The rows are rendered by React in the
   browser; here we cover the PURE metrics + the a11y invariants the submenu
   depends on (source-level, like window-preview.test.tsx). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBMENU_ID, menuMetrics } from "./context-menu-parts";

const src = readFileSync(resolve(__dirname, "context-menu-parts.tsx"), "utf8");

describe("menuMetrics", () => {
  it("reserves 44px rows on touch shells and 34/24px on desktop personas", () => {
    expect(menuMetrics("ios").rowH).toBe(44);
    expect(menuMetrics("android").rowH).toBe(44);
    expect(menuMetrics("windows").rowH).toBe(34);
    expect(menuMetrics("macos").rowH).toBe(24);
    expect(menuMetrics("dashboard").rowH).toBe(30);
    expect(menuMetrics("macos").width).toBe(244);
    expect(menuMetrics("windows").chrome).toBe("");
    expect(menuMetrics("ios").chrome).toBe("");
  });

  it("switches submenus to tap-to-open on touch shells only (fine pointer here)", () => {
    expect(menuMetrics("ios").tap).toBe(true);
    expect(menuMetrics("macos").tap).toBe(false);
  });

  it("keeps the Windows Fluent chrome distinct from the touch chrome", () => {
    expect(menuMetrics("windows").isWin).toBe(true);
    expect(menuMetrics("windows").radius).toBe("rounded-lg");
    expect(menuMetrics("ios").item).toContain("min-h-11");
  });
});

describe("submenu a11y invariants", () => {
  it("announces the parent row as a menu opener", () => {
    expect(src).toMatch(/aria-haspopup="menu"/);
    expect(src).toMatch(/aria-expanded=\{sub\?\.open === i\}/);
  });

  it("links the portalled panel back to its parent row", () => {
    // The panel is a SIBLING in the portal, not a DOM child, so aria-expanded alone
    // leaves AT with nothing to follow — it needs the id + owns/controls pair.
    expect(SUBMENU_ID).toBeTruthy();
    expect(src).toMatch(/id=\{SUBMENU_ID\}/);
    expect(src).toMatch(/aria-controls=\{sub\?\.open === i \? SUBMENU_ID : undefined\}/);
    expect(src).toMatch(/aria-owns=\{sub\?\.open === i \? SUBMENU_ID : undefined\}/);
  });

  it("marks a checked row with role=menuitemradio + aria-checked + a ✓ glyph", () => {
    expect(src).toMatch(/role=\{it\.checked === undefined \? "menuitem" : "menuitemradio"\}/);
    expect(src).toMatch(/aria-checked=\{it\.checked\}/);
    expect(src).toMatch(/<Check\b/); // never colour alone
  });

  it("floors every row at 44px on a coarse pointer (the CSS rule only covers role=menuitem)", () => {
    expect(src.match(/m\.tap && "min-h-11"/g)).toHaveLength(2);
  });
});
