import { describe, expect, it } from "vitest";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";

// iOS Safari zooms into any focused input whose font-size is below 16px, and it does not zoom back
// out. The page then looks broken until the user pinches.
//
// This test exists because the string assertion that was supposed to cover it passed while the real
// page was still wrong: it checked "input[type=search]", but the sidebar search is matched by the
// longer scoped selector ".integration .integration-sidebar-header>input[type=search]". Browser
// evidence caught the difference. So this file asserts the selector the page actually uses.
//
// --type-body is 1rem, which is exactly 16px, so it is the threshold with no raw literal.

const SEARCH = ".integration .integration-sidebar-header>input[type=search]";
const TRIGGER = ".integration .integration-settings-sidebar .owner-picker-trigger";

/** Every `selector{...}` block in the stylesheet, in order. */
function blocks(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

function bodyFor(css: string, selector: string): string | undefined {
  return blocks(css).find((b) => b.selector === selector)?.body;
}

describe("iOS auto-zoom threshold", () => {
  it("sizes the scoped sidebar search at the body token, not the caption token", () => {
    const body = bodyFor(CONNECTION_MANAGER_STYLE, SEARCH);
    expect(body, `${SEARCH} must exist; the page's search box is matched by this scoped selector`).toBeDefined();
    expect(body).toContain("font-size:var(--type-body)");
    expect(body).not.toContain("font-size:var(--type-caption)");
  });

  it("sizes the owner picker trigger the same way", () => {
    const body = bodyFor(CONNECTION_MANAGER_STYLE, TRIGGER);
    expect(body, `${TRIGGER} must exist`).toBeDefined();
    expect(body).toContain("font-size:var(--type-body)");
    expect(body).not.toContain("font-size:var(--type-caption)");
  });

  it("uses no caption-sized text field anywhere in the stylesheet", () => {
    const offenders = blocks(CONNECTION_MANAGER_STYLE)
      .filter((b) => /font-size:var\(--type-caption\)/.test(b.body))
      .filter((b) => /\binput\b|\bselect\b|\btextarea\b|owner-picker-trigger/.test(b.selector))
      .map((b) => b.selector);
    expect(offenders, "a caption-sized field triggers Safari zoom").toEqual([]);
  });
});
