/* Dock sizing (vitest, node env). The bar itself is rendered by React in the
   browser; here we cover the PURE fit math plus the one layout invariant that
   can't be expressed in it — WHICH element carries the overflow. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dockFit } from "./dock";

const src = readFileSync(resolve(__dirname, "dock.tsx"), "utf8");
const MED = 50; // DOCK_SIZE_PX.medium

describe("dockFit", () => {
  it("rests at the user's size when the row fits", () => {
    const { base, cramped, dockExtra } = dockFit(1920, 12, 2, MED, true);
    expect(base).toBe(MED);
    expect(cramped).toBe(false);
    expect(dockExtra).toBe(110); // 2.2× pool, magnification on
  });

  it("shrinks below the user's size before it ever scrolls", () => {
    const { base, cramped } = dockFit(1280, 27, 2, MED, true);
    expect(base).toBeLessThan(MED);
    expect(base).toBeGreaterThanOrEqual(22);
    expect(cramped).toBe(false);
  });

  it("scrolls once even the 22px floor can't fit (agent workspace on a phone-width viewport)", () => {
    const { base, cramped, dockExtra } = dockFit(768, 27, 2, MED, true);
    expect(cramped).toBe(true);
    expect(base).toBe(22); // floored, never smaller
    expect(dockExtra).toBe(0); // magnification off — its geometry assumes no scroll
  });

  it("reclaims the hover-growth reserve when magnification is off", () => {
    expect(dockFit(900, 27, 2, MED, false).base).toBeGreaterThan(dockFit(900, 27, 2, MED, true).base);
  });

  it("reserves the entire hover pool inside the viewport", () => {
    for (const vw of [844, 1024, 1280, 1512]) {
      const { base, cramped, dockExtra } = dockFit(vw, 27, 2, MED, true);
      if (!cramped) expect(base * 25 + 8 * 26 + 13 * 2 + 32 + dockExtra).toBeLessThanOrEqual(vw);
    }
  });

  it("never divides by zero on an empty dock", () => {
    expect(dockFit(1024, 0, 0, MED, false).base).toBe(MED);
  });
});

describe("cramped overflow", () => {
  // HoverPanel renders `absolute bottom-full` — ABOVE the row. `overflow-x` on the
  // row computes overflow-y from visible to auto (CSS Overflow 3), so the row must
  // NOT be the scroll container or every tooltip + window menu is clipped away.
  it("puts the scroll container on a padded wrapper, not on the glass row", () => {
    const row = src.slice(src.indexOf("ref={rowRef}"), src.indexOf("{slots.map"));
    expect(row).not.toMatch(/overflow-x-auto/);
    expect(row).toMatch(/cramped \? "w-max"/); // glass still spans every slot
    expect(src).toMatch(/cramped \? "-mt-64 max-w-\[calc\(100vw-16px\)\] overflow-x-auto pt-64/);
  });

  it("keeps the wrapper out of the hit-test path (no box at all when the row fits)", () => {
    expect(src).toMatch(/: "contents"/);
    // The 256px of headroom sits above the dock — it must never swallow clicks.
    expect(src.slice(src.indexOf("overflow-x-auto pt-64"), src.indexOf("ref={rowRef}"))).not.toMatch(/pointer-events-auto/);
  });
});
