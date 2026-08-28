import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Camoufox mobile layout", () => {
  it("lets the viewer consume remaining flex height instead of overflowing under chrome", () => {
    const src = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    expect(src).toContain("min-h-0 w-full flex-1 border-0 bg-black");
    expect(src).toContain("overflow-hidden bg-black");
    expect(src).toContain("allowFullScreen");
    expect(src).toContain("camoufoxViewerOrigin");
    expect(src).toContain('sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock allow-downloads"');
    expect(src).toContain('referrerPolicy="no-referrer"');
    expect(src).not.toContain('src="/camoufox-vnc/');
  });
});
