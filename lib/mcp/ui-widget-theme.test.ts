import { describe, expect, it } from "vitest";
import { MSO_BLOCK_RESOURCE } from "./ui-block";
import { MSO_PAGE_RESOURCE } from "./ui-surface";
import { MSO_SURFACE_SCRIPT } from "./ui-surface-script";
import { MSO_SURFACE_STYLE } from "./ui-surface-style";
import { MSO_WIDGET_THEME_SCRIPT, MSO_WIDGET_TOKENS } from "./ui-widget-tokens";

const canonicalHtml = `${MSO_BLOCK_RESOURCE.text}\n${MSO_PAGE_RESOURCE.text}`;

describe("Rahmanef widget theme", () => {
  it("mirrors the public site's light and dark palette from one shared token source", () => {
    expect(MSO_WIDGET_TOKENS).toContain("--text:#1c1c1f;");
    expect(MSO_WIDGET_TOKENS).toContain("--surface:#f4f4f7;");
    expect(MSO_WIDGET_TOKENS).toContain("--os-accent:#1f6df0;");
    expect(MSO_WIDGET_TOKENS).toContain("--info:#0060df;");
    expect(MSO_WIDGET_TOKENS).toContain(':root[data-theme="dark"]');
    expect(MSO_WIDGET_TOKENS).toContain("--text:#f2f2f5;");
    expect(MSO_WIDGET_TOKENS).toContain("--surface:#1b1b20;");
    expect(MSO_WIDGET_TOKENS).toContain("--info:#409cff;");
    expect(MSO_WIDGET_TOKENS).toContain(":root:not([data-theme])");
  });

  it("injects the same palette into Block and Page and removes the old generic purple theme", () => {
    expect(MSO_BLOCK_RESOURCE.text).toContain(MSO_WIDGET_TOKENS);
    expect(MSO_SURFACE_STYLE).toContain(MSO_WIDGET_TOKENS);
    expect(MSO_PAGE_RESOURCE.text).toContain(MSO_WIDGET_TOKENS);
    expect(canonicalHtml).not.toContain("#7c3aed");
    expect(canonicalHtml).not.toContain("CanvasText");
    expect(canonicalHtml).not.toContain("color:Canvas");
  });

  it("uses the editorial foreground/background inversion for primary actions", () => {
    expect(MSO_BLOCK_RESOURCE.text).toContain(
      "button.primary{border-color:var(--text);background:var(--text);color:var(--surface)}",
    );
    expect(MSO_SURFACE_STYLE).toContain(
      ".primary{border-color:var(--text);background:var(--text);color:var(--surface)}",
    );
  });

  it("tracks the ChatGPT host theme while retaining prefers-color-scheme fallback", () => {
    expect(MSO_WIDGET_THEME_SCRIPT).toContain("window.openai.theme");
    expect(MSO_WIDGET_THEME_SCRIPT).toContain('theme==="light"||theme==="dark"');
    expect(MSO_BLOCK_RESOURCE.text).toContain("applyHostTheme();readHostOutput()");
    expect(MSO_SURFACE_SCRIPT).toContain("applyHostTheme();");
    expect(MSO_PAGE_RESOURCE.text).toContain("window.openai.theme");
  });
});
