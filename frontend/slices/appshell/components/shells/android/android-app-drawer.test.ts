import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android All apps drawer contract", () => {
  it("has an explicit Home back control and safe-area-aware top region", () => {
    const src = readFileSync(new URL("./android-parts.tsx", import.meta.url), "utf8");
    expect(src).toContain('aria-label="Back to Home"');
    expect(src).toContain('data-slot="android-app-drawer-top"');
    expect(src).toContain('calc(var(--sai-top, 0px) + 8px)');
    expect(src).toContain('h-[48px] min-h-[48px]');
    expect(src).toContain('<h1 className="mx-auto text-[18px] font-medium">All apps</h1>');
  });
});
