import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile widget layout policy", () => {
  it("Shell widget selects the active surface instead of hard-coding desktop", () => {
    const src = readFileSync(new URL("./widgets-defs-vps.tsx", import.meta.url), "utf8");
    expect(src).toContain("shellsForSurface(surface)");
    expect(src).toContain("setShell(surface, s.id)");
    expect(src).not.toContain('shellsForSurface("desktop")');
  });

  it("Quicklinks and the mobile widget stack clip horizontal overflow", () => {
    const defs = readFileSync(new URL("./widgets-defs.tsx", import.meta.url), "utf8");
    const mobile = readFileSync(new URL("./mobile-widgets.tsx", import.meta.url), "utf8");
    expect(defs).toContain('data-slot="quicklinks-widget-grid"');
    expect(defs).toContain("overflow-x-clip");
    expect(mobile).toContain("overflow-x-clip");
    expect(mobile).toContain('data-slot="quick-open-grid"');
    expect(mobile).toContain("grid-cols-4");
  });
});
