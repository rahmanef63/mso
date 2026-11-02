import { describe, expect, it } from "vitest";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";
import { INTEGRATION_FORM_STYLE } from "./setup-ui";
import { PORTABILITY_STYLE } from "./portable/ui";
import { INTEGRATION_PAGE_STYLE } from "./setup-page";
import { SETTINGS_COMPACT_MAX } from "@/lib/presentation/responsive-contract";
import { readFileSync } from "node:fs";

const styles = {
  manager: CONNECTION_MANAGER_STYLE,
  setup: INTEGRATION_FORM_STYLE,
  portability: PORTABILITY_STYLE,
  page: INTEGRATION_PAGE_STYLE,
};

// CSS custom properties cannot be substituted inside container-query conditions.
// The generated CSS receives the query threshold from the shared responsive SSOT;
// feature source files themselves must not own that value.
function withoutSharedBreakpoint(css: string) {
  return css.replaceAll(SETTINGS_COMPACT_MAX, "TOKEN_BREAKPOINT");
}

describe("Integrations visual token contract", () => {
  it.each(Object.entries(styles))("%s has no feature-local colors or absolute visual lengths", (_name, css) => {
    const value = withoutSharedBreakpoint(css);
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
  it("keeps the structural query threshold outside Integrations feature source", () => {
    for (const file of ["connection-ui-style.ts", "setup-ui.ts", "portable/ui.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toContain(SETTINGS_COMPACT_MAX);
      expect(source).toContain("SETTINGS_COMPACT_MAX");
    }
  });

  it("enforces WCAG AA compliant text token for missing credential fields (R-25)", () => {
    expect(CONNECTION_MANAGER_STYLE).toContain(".credential-field-state{font-size:var(--type-caption);color:var(--destructive-text)}");
    expect(CONNECTION_MANAGER_STYLE).not.toContain("color:var(--warning)");
  });

  it("enforces minimum control-size tap targets for interactive elements (R-03)", () => {
    // Summary disclosure targets
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration summary{display:flex;align-items:center;min-height:var(--control-size);cursor:pointer}");
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .identity-guide summary{display:flex;align-items:center;min-height:var(--control-size);cursor:pointer;font-weight:var(--weight-strong)}");
    expect(INTEGRATION_FORM_STYLE).toContain(".integration summary{display:flex;align-items:center;min-height:var(--control-size);cursor:pointer;font-weight:var(--weight-strong)}");

    // Guide inline links
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .identity-guide a{display:inline-flex;align-items:center;min-height:var(--control-size)");
    expect(INTEGRATION_FORM_STYLE).toContain(".integration details a{display:inline-flex;align-items:center;min-height:var(--control-size)}");

    // Checkbox labels
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .identity-check{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-size);cursor:pointer;font-weight:var(--weight-regular)}");
    expect(PORTABILITY_STYLE).toContain(".portable-transfer .identity-check{display:flex;gap:var(--space-2);align-items:center;min-height:var(--control-size);cursor:pointer;font-weight:var(--weight-regular)}");
  });
});
