import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// One sidebar surface for the whole product.
//
// The complaint was concrete: under the same macOS shell, Finder rendered a 192px rail,
// Code 240px, Store 160px and Integrations 224px, because each feature owned a literal
// width class. Width belongs to the active shell (`--feature-sidebar-width` in
// design/layout.ts); a feature may pick a ratio, never a pixel value.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const SIDEBAR_CONSUMERS = [
  "../../appshell/components/layout/app-chrome.tsx",
  "../../files-manager/app.tsx",
  "../../app-store/components/store-sidebar.tsx",
  "../../os-settings/components/settings-shell.tsx",
  "../../code-editor/app.tsx",
  "../../appshell/components/shells/dashboard/dashboard-shell.tsx",
];

describe("shared sidebar width", () => {
  it("derives the rail from the shell token, not a literal width", () => {
    const chrome = read(SIDEBAR_CONSUMERS[0]);
    expect(chrome).toContain("w-[var(--feature-sidebar-width,14rem)]");
    expect(chrome).toContain("w-[calc(var(--feature-sidebar-width,14rem)*0.8)]");
    expect(chrome).not.toMatch(/railBase="flex w-\d/);
  });

  // w-48 / w-52 / w-40 were the concrete regression: three widths, one shell. The
  // Dashboard rail had its own w-60 on top of that.
  it("removes per-feature literal rail widths", () => {
    const files = read(SIDEBAR_CONSUMERS[1]);
    expect(files).not.toMatch(/railClassName=\{[^}]*w-(40|48|52|56|64)\b/);
    const store = read(SIDEBAR_CONSUMERS[2]);
    expect(store).not.toMatch(/<aside className="[^"]*\bw-40\b/);
    expect(store).toContain("calc(var(--feature-sidebar-width,14rem)*0.8)");
    const dashboard = read(SIDEBAR_CONSUMERS[5]);
    expect(dashboard).not.toMatch(/<aside className="[^"]*\bw-60\b/);
    expect(dashboard).toContain("w-[var(--feature-sidebar-width,14rem)]");
  });

  it("keeps the ratio variants inside the one chrome component", () => {
    const chrome = read(SIDEBAR_CONSUMERS[0]);
    const widths = [...chrome.matchAll(/^\s{2}(narrow|default|wide):/gm)].map((m) => m[1]);
    expect(widths).toEqual(["narrow", "default"]);
  });
});

// The Integrations manager is a native DOM surface, so it cannot import the React
// sidebar. What it CAN share is the same token contract; this is the seam that keeps a
// future change to shell width from silently diverging between React features and the
// iframe.
describe("native DOM sidebar token parity", () => {
  it("sizes the Integrations sidebar from the same shell token", () => {
    const style = readFileSync("lib/infra/connection-ui-style.ts", "utf8");
    expect(style).toContain("grid-template-columns:var(--feature-sidebar-width,var(--settings-sidebar-width))");
  });

  it("receives that token through the iframe theme bridge", () => {
    const bridge = readFileSync("frontend/slices/integrations/frame-theme.ts", "utf8");
    expect(bridge).toContain('["--feature-sidebar-width", "--feature-sidebar-width"]');
  });
});

// Colour lives in tokens. The Code editor deliberately keeps the VS Code palette (see its
// file-level `audit-allow-hex` marker), so it is exempt from tokenising its editor chrome;
// what must hold is that every OTHER sidebar uses tokens.
describe("sidebar colours come from tokens", () => {
  it("keeps the documented VS Code exemption in one place, not as a pattern", () => {
    const code = read(SIDEBAR_CONSUMERS[4]);
    expect(code.split("\n")[1]).toContain("audit-allow-hex:");
  });

  it("paints every other sidebar with semantic tokens, not literals", () => {
    for (const path of [SIDEBAR_CONSUMERS[0], SIDEBAR_CONSUMERS[1], SIDEBAR_CONSUMERS[2], SIDEBAR_CONSUMERS[3], SIDEBAR_CONSUMERS[5]]) {
      const source = read(path);
      expect(source).not.toMatch(/railClassName="[^"]*bg-\[#/);
      expect(source).not.toMatch(/aside className="[^"]*bg-\[#/);
    }
  });
});
