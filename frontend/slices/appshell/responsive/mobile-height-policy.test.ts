import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile full-height policy", () => {
  it("sizes the shell from the synchronized visual viewport token", () => {
    const surface = readFileSync(new URL("../components/desktop.tsx", import.meta.url), "utf8");
    const provider = readFileSync(new URL("./responsive-provider.tsx", import.meta.url), "utf8");
    expect(surface).toContain("--mso-visual-vh");
    expect(surface).not.toContain('className="relative h-dvh w-screen');
    expect(provider).toContain('window.visualViewport?.addEventListener("resize", schedule)');
    expect(provider).toContain('(orientation: portrait)');
  });
});
