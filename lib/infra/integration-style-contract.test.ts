import { describe, expect, it } from "vitest";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";
import { INTEGRATION_FORM_STYLE } from "./setup-ui";
import { PORTABILITY_STYLE } from "./portable/ui";
import { INTEGRATION_PAGE_STYLE } from "./setup-page";

const styles = {
  manager: CONNECTION_MANAGER_STYLE,
  setup: INTEGRATION_FORM_STYLE,
  portability: PORTABILITY_STYLE,
  page: INTEGRATION_PAGE_STYLE,
};

// CSS custom properties cannot be substituted inside container-query conditions,
// so the one shared structural breakpoint is intentionally exempt. Every visual
// declaration inside the feature must consume semantic tokens instead of literals.
function withoutStructuralBreakpoint(css: string) {
  return css.replaceAll("37.5rem", "TOKEN_BREAKPOINT");
}

describe("Integrations visual token contract", () => {
  it.each(Object.entries(styles))("%s has no feature-local colors or absolute visual lengths", (_name, css) => {
    const value = withoutStructuralBreakpoint(css);
    expect(value).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(value).not.toMatch(/rgba?\s*\(/i);
    expect(value).not.toMatch(/hsla?\s*\(/i);
    expect(value).not.toMatch(/\b\d+(?:\.\d+)?px\b/i);
    expect(value).not.toMatch(/\b\d+(?:\.\d+)?rem\b/i);
    expect(value).not.toMatch(/font-weight\s*:\s*\d+/i);
    expect(value).not.toMatch(/(?:^|[:;,\s])(white|black)(?:[;,\s}]|$)/i);
  });

  it("uses the shared Settings semantic surfaces and accent", () => {
    expect(CONNECTION_MANAGER_STYLE).toContain("var(--settings-card)");
    expect(CONNECTION_MANAGER_STYLE).toContain("var(--settings-sidebar)");
    expect(CONNECTION_MANAGER_STYLE).toContain("var(--primary)");
    expect(PORTABILITY_STYLE).toContain("var(--settings-card)");
    expect(INTEGRATION_FORM_STYLE).toContain("var(--settings-card)");
    expect(CONNECTION_MANAGER_STYLE).toContain("color:var(--settings-action-text)");
    expect(INTEGRATION_FORM_STYLE).toContain("color:var(--settings-action-text)");
  });
});
